/**
 * LosslessContextEngine — the default context engine for Kyle's OpenClaw.
 *
 * Implements the full ContextEngine interface with lossless DAG-based
 * context management built-in from day one. No plugin needed — this
 * IS the core.
 *
 * Key advantages over OpenClaw's default context management:
 *
 * 1. LOSSLESS: Every message is preserved in the DAG. Summaries link
 *    back to originals. The model can expand any summary on demand.
 *
 * 2. PROACTIVE: Memory flush triggers at softFlushThreshold (60%),
 *    well before compaction at compactionThreshold (75%). Decisions,
 *    state changes, and lessons are checkpointed to disk continuously.
 *
 * 3. SMART PRUNING: Tool results aren't blindly removed — we check if
 *    recent conversation references them before pruning.
 *
 * 4. CASCADING COMPRESSION: The DAG auto-condenses at multiple depths.
 *    Depth-1 summaries become depth-2 when they accumulate. No limit
 *    on depth by default — conversations can run forever.
 *
 * 5. HYBRID ASSEMBLY: The final context combines DAG summaries +
 *    memory search results + skills metadata + fresh messages,
 *    maximizing information density within the context window.
 */

import type {
  ContextEngine,
  BootstrapResult,
  IngestResult,
  AssembleResult,
  CompactResult,
  FlushResult,
  SubagentContext,
  SubagentResult,
} from "@kyles-openclaw/shared";
import type {
  Message,
  Session,
  AgentConfig,
  MemorySearchResult,
  SkillMetadata,
} from "@kyles-openclaw/shared";
import { DagStore } from "./dag-store.js";
import { Compactor } from "./compactor.js";
import { Assembler } from "./assembler.js";
import { Summarizer, type SummarizeFn } from "./summarizer.js";
import { Pruner } from "./pruner.js";
import { TokenCounter } from "./token-counter.js";

export interface LosslessEngineOptions {
  callLLM: SummarizeFn;
  searchMemory?: (query: string) => Promise<MemorySearchResult[]>;
  loadSkills?: () => Promise<SkillMetadata[]>;
  writeMemory?: (content: string, path: string) => Promise<void>;
}

export class LosslessContextEngine implements ContextEngine {
  readonly name = "lossless";

  private dagStore: DagStore;
  private compactor: Compactor;
  private assembler: Assembler;
  private summarizer: Summarizer;
  private pruner: Pruner;
  private tokenCounter: TokenCounter;
  private options: LosslessEngineOptions;

  /** Track fresh (uncompacted) messages per session */
  private freshMessages = new Map<string, Message[]>();
  /** Track whether we've flushed at the soft threshold */
  private hasFlushedThisCycle = new Map<string, boolean>();

  constructor(config: AgentConfig, options: LosslessEngineOptions) {
    this.tokenCounter = new TokenCounter();
    this.dagStore = new DagStore(this.tokenCounter);
    this.pruner = new Pruner(config.context);
    this.summarizer = new Summarizer(
      options.callLLM,
      config.context.summarizationModel ?? config.model,
      this.tokenCounter
    );
    this.compactor = new Compactor(
      this.dagStore,
      this.summarizer,
      config.context,
      this.tokenCounter
    );
    this.assembler = new Assembler(
      this.dagStore,
      this.pruner,
      this.tokenCounter
    );
    this.options = options;
  }

  async bootstrap(
    session: Session,
    config: AgentConfig
  ): Promise<BootstrapResult> {
    this.freshMessages.set(session.id, []);
    this.hasFlushedThisCycle.set(session.id, false);

    // Load any existing DAG nodes from a previous session
    // (session persistence would load from JSONL here)

    const systemPrompt = config.systemPrompt;
    const tokenCount = this.tokenCounter.count(systemPrompt);

    return {
      systemPrompt,
      bootstrapMessages: [],
      tokenCount,
    };
  }

  async ingest(message: Message, session: Session): Promise<IngestResult> {
    // Add to DAG as a raw node
    this.dagStore.addRawMessage(session.id, message);

    // Add to fresh messages list
    const fresh = this.freshMessages.get(session.id) ?? [];
    fresh.push(message);
    this.freshMessages.set(session.id, fresh);

    const tokenCount = this.tokenCounter.count(message.content);

    return {
      message,
      checkCompaction: true,
      tokenCount,
    };
  }

  async assemble(
    session: Session,
    config: AgentConfig
  ): Promise<AssembleResult> {
    const fresh = this.freshMessages.get(session.id) ?? [];

    // Search memory for relevant context
    let memories: MemorySearchResult[] = [];
    if (this.options.searchMemory && fresh.length > 0) {
      const lastUserMsg = [...fresh]
        .reverse()
        .find((m) => m.role === "user");
      if (lastUserMsg) {
        memories = await this.options.searchMemory(lastUserMsg.content);
      }
    }

    // Load skills metadata
    const skills = this.options.loadSkills
      ? await this.options.loadSkills()
      : [];

    return this.assembler.assemble(
      session.id,
      config,
      fresh,
      memories,
      skills
    );
  }

  async compact(
    session: Session,
    config: AgentConfig
  ): Promise<CompactResult> {
    const result = await this.compactor.compact(
      session.id,
      config.model.contextWindow
    );

    // After compaction, update fresh messages to only include the tail
    const fresh = this.freshMessages.get(session.id) ?? [];
    const tailCount = config.context.freshTailCount;
    this.freshMessages.set(session.id, fresh.slice(-tailCount));

    // Reset flush cycle
    this.hasFlushedThisCycle.set(session.id, false);

    return {
      messagesCompacted: result.nodesCreated.reduce(
        (sum, n) => sum + n.childIds.length,
        0
      ),
      nodesCreated: result.nodesCreated,
      tokensSaved: result.tokensSaved,
      needsMoreCompaction:
        this.dagStore.getRootTokenCount(session.id) >
        config.model.contextWindow * config.context.compactionThreshold,
    };
  }

  async afterTurn(
    session: Session,
    _response: Message,
    config: AgentConfig
  ): Promise<void> {
    // Check if we need proactive flush
    const currentTokens = this.estimateCurrentTokens(session.id);
    const softThreshold =
      config.model.contextWindow * config.context.softFlushThreshold;

    if (
      currentTokens > softThreshold &&
      !this.hasFlushedThisCycle.get(session.id)
    ) {
      await this.proactiveFlush(session, config);
    }

    // Check if we need compaction
    const compactionThreshold =
      config.model.contextWindow * config.context.compactionThreshold;

    if (currentTokens > compactionThreshold) {
      await this.compact(session, config);
    }
  }

  async proactiveFlush(
    session: Session,
    config: AgentConfig
  ): Promise<FlushResult> {
    this.hasFlushedThisCycle.set(session.id, true);

    const fresh = this.freshMessages.get(session.id) ?? [];
    if (fresh.length === 0) {
      return { memoriesWritten: 0, outputPath: "", categories: [] };
    }

    // Extract key information to persist
    const content = fresh.map((m) => `[${m.role}]: ${m.content}`).join("\n\n");

    const flushPrompt = `Extract the following from this conversation and format as markdown:
1. **Decisions made** — any choices or conclusions reached
2. **State changes** — files modified, settings changed, deployments done
3. **Lessons learned** — errors encountered and how they were resolved
4. **Active blockers** — unresolved issues or questions
5. **Key facts** — names, paths, configurations worth remembering

Be concise. Only include items actually present in the conversation.

CONVERSATION:
${content}`;

    try {
      const extracted = await this.options.callLLM(
        flushPrompt,
        config.context.summarizationModel ?? config.model
      );

      const date = new Date().toISOString().split("T")[0];
      const outputPath = `${config.memory.memoryDir}/${date}.md`;

      if (this.options.writeMemory) {
        await this.options.writeMemory(
          `\n\n---\n\n## Session ${session.id} — ${new Date().toISOString()}\n\n${extracted}`,
          outputPath
        );
      }

      return {
        memoriesWritten: 1,
        outputPath,
        categories: [
          "decisions",
          "state_changes",
          "lessons",
          "blockers",
          "key_facts",
        ],
      };
    } catch {
      return { memoriesWritten: 0, outputPath: "", categories: [] };
    }
  }

  async prepareSubagentSpawn(
    session: Session,
    taskDescription: string
  ): Promise<SubagentContext> {
    // Assemble a condensed version of context for the subagent
    const rootNodes = this.dagStore.getRootNodes(session.id);
    const summaryContent = rootNodes
      .map((n) => n.content)
      .join("\n\n---\n\n");

    const contextMsg: Message = {
      id: "subagent-context",
      role: "system",
      content: `## Parent Context Summary\n${summaryContent}\n\n## Your Task\n${taskDescription}`,
      timestamp: Date.now(),
    };

    // Search memory for task-relevant context
    let memories: string[] = [];
    if (this.options.searchMemory) {
      const results = await this.options.searchMemory(taskDescription);
      memories = results.map((r) => r.content);
    }

    return {
      messages: [contextMsg],
      memories,
      tokenBudget: 50000, // reasonable budget for subagent
    };
  }

  async onSubagentEnded(
    session: Session,
    subagentResult: SubagentResult
  ): Promise<void> {
    // Ingest subagent result as a message
    const resultMsg: Message = {
      id: `subagent-result-${Date.now()}`,
      role: "assistant",
      content: `## Subagent Result: ${subagentResult.task}\n\n${subagentResult.output}`,
      timestamp: Date.now(),
    };

    await this.ingest(resultMsg, session);

    // Write any memories the subagent created
    if (subagentResult.memories.length > 0 && this.options.writeMemory) {
      const date = new Date().toISOString().split("T")[0];
      const content = subagentResult.memories.join("\n\n");
      await this.options.writeMemory(
        content,
        `${date}-subagent.md`
      );
    }
  }

  // ─── Context Tools (exposed to the LLM) ────────────

  /**
   * lcm_expand — drill into a summary to see its children.
   */
  expand(nodeId: string): string {
    const children = this.dagStore.expand(nodeId);
    if (children.length === 0) return "Node not found or has no children.";

    return children
      .map(
        (child) =>
          `<node id="${child.id}" type="${child.type}" depth="${child.depth}">\n${child.content}\n</node>`
      )
      .join("\n\n");
  }

  /**
   * lcm_grep — search across all history including compacted.
   */
  grep(sessionId: string, query: string): string {
    const results = this.dagStore.grep(sessionId, query);
    if (results.length === 0) return "No matches found.";

    return results
      .slice(0, 20) // limit results
      .map(
        (node) =>
          `[${node.type} depth=${node.depth} id=${node.id}]: ${node.content.slice(0, 200)}...`
      )
      .join("\n\n");
  }

  /**
   * lcm_describe — get metadata about a DAG node.
   */
  describe(nodeId: string): string {
    return this.dagStore.describe(nodeId);
  }

  /**
   * Get DAG statistics for debugging/monitoring.
   */
  getStats(sessionId: string) {
    return this.dagStore.getStats(sessionId);
  }

  private estimateCurrentTokens(sessionId: string): number {
    const fresh = this.freshMessages.get(sessionId) ?? [];
    const freshTokens = this.tokenCounter.countMessages(
      fresh.map((m) => ({ content: m.content, role: m.role }))
    );
    const dagTokens = this.dagStore.getRootTokenCount(sessionId);
    return freshTokens + dagTokens;
  }
}
