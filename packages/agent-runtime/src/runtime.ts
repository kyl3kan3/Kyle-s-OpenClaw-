/**
 * AgentRuntime — the core AI agent loop.
 *
 * This is the heart of Kyle's OpenClaw. It runs the complete
 * agent cycle: receive message → assemble context → call LLM →
 * execute tools → respond. The LosslessContextEngine handles
 * all context management automatically.
 *
 * Architecture (hub-and-spoke):
 * - Gateway dispatches messages TO the runtime
 * - Runtime assembles context, calls LLM, executes tools
 * - Runtime sends responses back THROUGH the gateway
 *
 * The runtime runs in-process (not a separate service).
 */

import type {
  AgentConfig,
  Message,
  Session,
  ToolCall,
  ToolDefinition,
  InboundMessage,
  OutboundMessage,
} from "@kyles-openclaw/shared";
import type { ContextEngine } from "@kyles-openclaw/shared";
import { SimpleEventBus } from "@kyles-openclaw/shared";
import { LosslessContextEngine } from "@kyles-openclaw/context-engine";
import { MemoryIndexManager } from "@kyles-openclaw/memory";
import { SessionManager } from "./session-manager.js";
import { ToolRegistry } from "./tool-registry.js";
import { SkillsLoader } from "./skills-loader.js";

export type LLMCallFn = (
  messages: Array<{ role: string; content: string }>,
  tools: Array<{ name: string; description: string; parameters: Record<string, unknown> }>,
  config: AgentConfig
) => Promise<{
  content: string;
  toolCalls?: ToolCall[];
}>;

export interface RuntimeOptions {
  config: AgentConfig;
  callLLM: LLMCallFn;
  embedFn: (texts: string[]) => Promise<number[][]>;
  onOutbound?: (message: OutboundMessage) => Promise<void>;
}

export class AgentRuntime {
  private config: AgentConfig;
  private callLLM: LLMCallFn;
  private contextEngine: ContextEngine;
  private memoryManager: MemoryIndexManager;
  private sessionManager: SessionManager;
  private toolRegistry: ToolRegistry;
  private skillsLoader: SkillsLoader;
  private eventBus: SimpleEventBus;
  private onOutbound?: (message: OutboundMessage) => Promise<void>;

  constructor(options: RuntimeOptions) {
    this.config = options.config;
    this.callLLM = options.callLLM;
    this.onOutbound = options.onOutbound;
    this.eventBus = new SimpleEventBus();

    // Initialize memory
    this.memoryManager = new MemoryIndexManager(
      options.config.memory,
      options.embedFn
    );

    // Initialize context engine with lossless DAG
    this.contextEngine = new LosslessContextEngine(options.config, {
      callLLM: async (prompt, model) => {
        const result = await options.callLLM(
          [{ role: "user", content: prompt }],
          [],
          { ...options.config, model }
        );
        return result.content;
      },
      searchMemory: (query) => this.memoryManager.search(query),
      loadSkills: () => this.skillsLoader.loadAll(),
      writeMemory: (content, path) =>
        this.memoryManager.writeMemory(content, path).then(() => {}),
    });

    // Initialize session manager
    this.sessionManager = new SessionManager(
      `${options.config.workspaceDir}/sessions`
    );

    // Initialize tool registry with built-in tools
    this.toolRegistry = new ToolRegistry();
    this.registerBuiltInTools();

    // Initialize skills loader
    this.skillsLoader = new SkillsLoader(options.config.skillsDirs);
  }

  /**
   * Initialize the runtime — must be called before processing messages.
   */
  async init(): Promise<void> {
    await this.sessionManager.init();
    await this.memoryManager.init();
  }

  /**
   * Process an inbound message through the full agent loop.
   */
  async processMessage(inbound: InboundMessage): Promise<void> {
    await this.eventBus.emit("message:inbound", inbound);

    // Get or create session
    const session = await this.sessionManager.getOrCreate(
      this.config.id,
      inbound.channelId
    );

    // Create message object
    const userMessage: Message = {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      role: "user",
      content: inbound.content,
      timestamp: inbound.timestamp,
      metadata: inbound.metadata,
    };

    // Ingest into context engine
    await this.contextEngine.ingest(userMessage, session);
    await this.sessionManager.addMessage(session.id, userMessage);

    // Run the agent loop (may involve multiple tool calls)
    await this.agentLoop(session);
  }

  /**
   * The core agent loop: assemble → call LLM → handle tools → repeat.
   */
  private async agentLoop(session: Session): Promise<void> {
    const maxIterations = 20; // safety limit

    for (let i = 0; i < maxIterations; i++) {
      await this.eventBus.emit("agent:turn_started", {
        sessionId: session.id,
        iteration: i,
      });

      // Assemble context
      const assembled = await this.contextEngine.assemble(
        session,
        this.config
      );

      // Call LLM
      const llmMessages = assembled.messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const response = await this.callLLM(
        llmMessages,
        this.toolRegistry.getDefinitions(),
        this.config
      );

      // Create assistant message
      const assistantMessage: Message = {
        id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        role: "assistant",
        content: response.content,
        timestamp: Date.now(),
        toolCalls: response.toolCalls,
      };

      await this.contextEngine.ingest(assistantMessage, session);
      await this.sessionManager.addMessage(session.id, assistantMessage);

      // If no tool calls, we're done — send the response
      if (!response.toolCalls || response.toolCalls.length === 0) {
        if (response.content && this.onOutbound) {
          await this.onOutbound({
            channelId: session.channelId,
            content: response.content,
          });
        }

        // After-turn hooks (proactive flush, compaction check)
        await this.contextEngine.afterTurn(
          session,
          assistantMessage,
          this.config
        );

        await this.eventBus.emit("agent:turn_completed", {
          sessionId: session.id,
          stats: assembled.stats,
        });
        return;
      }

      // Execute tool calls
      for (const toolCall of response.toolCalls) {
        await this.eventBus.emit("tool:called", toolCall);

        const result = await this.toolRegistry.execute(toolCall);

        const toolMessage: Message = {
          id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          role: "tool",
          content: result.content,
          timestamp: Date.now(),
          toolCallId: toolCall.id,
        };

        await this.contextEngine.ingest(toolMessage, session);
        await this.sessionManager.addMessage(session.id, toolMessage);
        await this.eventBus.emit("tool:result", result);
      }

      // Loop back for next LLM call with tool results
    }

    // Safety: if we hit max iterations
    if (this.onOutbound) {
      await this.onOutbound({
        channelId: session.channelId,
        content:
          "I've reached the maximum number of tool call iterations. Please rephrase your request.",
      });
    }
  }

  /**
   * Register built-in context management tools.
   */
  private registerBuiltInTools(): void {
    const engine = this.contextEngine as LosslessContextEngine;

    const builtInTools: ToolDefinition[] = [
      {
        name: "lcm_expand",
        description:
          "Expand a context summary node to see its original messages. Use when you need more detail about something in the compacted history.",
        parameters: {
          type: "object",
          properties: {
            nodeId: {
              type: "string",
              description: "The ID of the DAG node to expand",
            },
          },
          required: ["nodeId"],
        },
        execute: async (args) => ({
          toolCallId: "",
          content: engine.expand(args.nodeId as string),
        }),
      },
      {
        name: "lcm_grep",
        description:
          "Search across all conversation history, including compacted/summarized messages. Use to find specific information mentioned earlier.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "The search query",
            },
            sessionId: {
              type: "string",
              description: "Session ID to search in",
            },
          },
          required: ["query", "sessionId"],
        },
        execute: async (args) => ({
          toolCallId: "",
          content: engine.grep(
            args.sessionId as string,
            args.query as string
          ),
        }),
      },
      {
        name: "lcm_describe",
        description:
          "Get metadata about a context summary node — how many messages it covers, its depth, token count.",
        parameters: {
          type: "object",
          properties: {
            nodeId: {
              type: "string",
              description: "The ID of the DAG node to describe",
            },
          },
          required: ["nodeId"],
        },
        execute: async (args) => ({
          toolCallId: "",
          content: engine.describe(args.nodeId as string),
        }),
      },
      {
        name: "memory_search",
        description:
          "Search long-term memory files using hybrid BM25 + vector search. Use to recall information from past sessions.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description:
                "Natural language query to search memory for",
            },
          },
          required: ["query"],
        },
        execute: async (args) => {
          const results = await this.memoryManager.search(
            args.query as string
          );
          if (results.length === 0) return { toolCallId: "", content: "No memories found matching that query." };
          return {
            toolCallId: "",
            content: results
              .map(
                (r) =>
                  `[${r.method} score=${r.score.toFixed(2)} source=${r.source}]\n${r.content}`
              )
              .join("\n\n---\n\n"),
          };
        },
      },
    ];

    this.toolRegistry.registerAll(builtInTools);
  }

  /**
   * Register additional tools.
   */
  registerTool(tool: ToolDefinition): void {
    this.toolRegistry.register(tool);
  }

  /**
   * Get the event bus for subscribing to runtime events.
   */
  getEventBus(): SimpleEventBus {
    return this.eventBus;
  }

  /**
   * Get context engine stats for monitoring.
   */
  getContextStats(sessionId: string) {
    return (this.contextEngine as LosslessContextEngine).getStats(sessionId);
  }
}
