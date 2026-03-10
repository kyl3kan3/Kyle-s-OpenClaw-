/**
 * Assembler — constructs the final context window for the LLM.
 *
 * This is where lossless context management pays off.
 * Instead of sending a flat list of messages, we assemble:
 *
 * 1. System prompt (with workspace bootstrap)
 * 2. DAG root summaries (compressed historical context)
 * 3. Memory search results (relevant long-term memory)
 * 4. Skills metadata (discoverable, not loaded)
 * 5. Fresh tail messages (recent uncompacted conversation)
 *
 * The model also gets lcm_expand, lcm_grep, lcm_describe tools
 * so it can drill into any summary for full detail.
 */

import type {
  Message,
  AgentConfig,
  SkillMetadata,
  MemorySearchResult,
} from "@kyles-openclaw/shared";
import type { AssembleResult } from "@kyles-openclaw/shared";
import { DagStore } from "./dag-store.js";
import { Pruner } from "./pruner.js";
import { TokenCounter } from "./token-counter.js";

export class Assembler {
  private dagStore: DagStore;
  private pruner: Pruner;
  private tokenCounter: TokenCounter;

  constructor(dagStore: DagStore, pruner: Pruner, tokenCounter?: TokenCounter) {
    this.dagStore = dagStore;
    this.pruner = pruner;
    this.tokenCounter = tokenCounter ?? new TokenCounter();
  }

  /**
   * Assemble the complete context for an LLM call.
   */
  assemble(
    sessionId: string,
    config: AgentConfig,
    freshMessages: Message[],
    memories: MemorySearchResult[],
    skills: SkillMetadata[]
  ): AssembleResult {
    const messages: Message[] = [];
    let totalTokens = 0;
    let summarizedBlockCount = 0;
    let memoryInjectionCount = 0;

    // 1. System prompt with workspace context
    const systemPrompt = this.buildSystemPrompt(config, skills);
    const systemMsg: Message = {
      id: "system",
      role: "system",
      content: systemPrompt,
      timestamp: Date.now(),
    };
    messages.push(systemMsg);
    totalTokens += this.tokenCounter.count(systemPrompt);

    // 2. DAG summaries (compressed history)
    const rootNodes = this.dagStore.getRootNodes(sessionId);
    const summaryNodes = rootNodes.filter((n) => n.type !== "raw");

    if (summaryNodes.length > 0) {
      const summaryContent = summaryNodes
        .map((node) => {
          const desc = this.dagStore.describe(node.id);
          return `<context-summary id="${node.id}" depth="${node.depth}">\n${node.content}\n<!-- ${desc} — use lcm_expand("${node.id}") to see original messages -->\n</context-summary>`;
        })
        .join("\n\n");

      const historyMsg: Message = {
        id: "dag-summaries",
        role: "system",
        content: `## Compacted History\nThe following are summaries of earlier conversation. Originals are preserved — use lcm_expand(id) to drill into any summary.\n\n${summaryContent}`,
        timestamp: Date.now(),
      };
      messages.push(historyMsg);
      totalTokens += this.tokenCounter.count(historyMsg.content);
      summarizedBlockCount = summaryNodes.length;
    }

    // 3. Memory injections (relevant long-term context)
    if (memories.length > 0) {
      const memoryContent = memories
        .map(
          (m) =>
            `<memory source="${m.source}" score="${m.score.toFixed(2)}" method="${m.method}">\n${m.content}\n</memory>`
        )
        .join("\n\n");

      const memoryMsg: Message = {
        id: "memory-injection",
        role: "system",
        content: `## Relevant Memories\n${memoryContent}`,
        timestamp: Date.now(),
      };
      messages.push(memoryMsg);
      totalTokens += this.tokenCounter.count(memoryMsg.content);
      memoryInjectionCount = memories.length;
    }

    // 4. Fresh messages (uncompacted recent conversation)
    const prunedFresh = this.pruner.prune(freshMessages);
    for (const msg of prunedFresh) {
      messages.push(msg);
      totalTokens += this.tokenCounter.count(msg.content) + 4;
    }

    return {
      messages,
      totalTokens,
      stats: {
        rawMessageCount: prunedFresh.length,
        summarizedBlockCount,
        memoryInjectionCount,
        skillsMetadataCount: skills.length,
      },
    };
  }

  /**
   * Build the system prompt with skills metadata injected.
   * Skills are metadata-only — the agent reads SKILL.md on demand.
   */
  private buildSystemPrompt(
    config: AgentConfig,
    skills: SkillMetadata[]
  ): string {
    let prompt = config.systemPrompt;

    if (skills.length > 0) {
      const skillsList = skills
        .map(
          (s) =>
            `- **${s.name}**: ${s.description} (read "${s.path}" for details)`
        )
        .join("\n");

      prompt += `\n\n## Available Skills\nThe following skills are available. Read the SKILL.md file for any skill you want to use.\n${skillsList}`;
    }

    // Add context management tools documentation
    prompt += `\n\n## Context Tools
You have access to these tools for exploring compacted history:
- **lcm_expand(nodeId)**: Expand a summary to see its source messages
- **lcm_grep(query)**: Search across all history (including compacted)
- **lcm_describe(nodeId)**: Get metadata about a context summary node
- **memory_search(query)**: Search long-term memory files`;

    return prompt;
  }
}
