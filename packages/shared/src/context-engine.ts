/**
 * ContextEngine plugin interface — the heart of Kyle's OpenClaw.
 *
 * Unlike original OpenClaw where context management was hardcoded,
 * we make it pluggable from day one with full lifecycle hooks.
 *
 * Inspired by OpenClaw v2026.3.7's ContextEngine plugin slot
 * and the Lossless Context Management (LCM) paper.
 */

import type { Message, Session, AgentConfig, DagNode } from "./types.js";

// ─── Lifecycle Hooks ────────────────────────────────────

export interface ContextEngine {
  readonly name: string;

  /**
   * Called once when the agent starts a new session.
   * Load workspace files, USER.md, bootstrap context.
   */
  bootstrap(session: Session, config: AgentConfig): Promise<BootstrapResult>;

  /**
   * Called when a new message arrives. Decides how to ingest it
   * into the context — raw append, chunked, or with metadata.
   */
  ingest(message: Message, session: Session): Promise<IngestResult>;

  /**
   * Assembles the final context to send to the LLM.
   * This is where the magic happens — DAG traversal, summary expansion,
   * memory injection, skills metadata.
   */
  assemble(session: Session, config: AgentConfig): Promise<AssembleResult>;

  /**
   * Triggered when context exceeds the threshold.
   * In lossless mode: creates DAG summaries instead of destroying history.
   * Originals are ALWAYS preserved in the database.
   */
  compact(session: Session, config: AgentConfig): Promise<CompactResult>;

  /**
   * Called after each LLM turn completes.
   * Opportunity for proactive memory flush, metrics, etc.
   */
  afterTurn(
    session: Session,
    response: Message,
    config: AgentConfig
  ): Promise<void>;

  /**
   * Proactive memory checkpoint — called when context hits soft threshold.
   * Unlike OpenClaw's reactive flush, we checkpoint BEFORE things get critical.
   * Extracts decisions, state changes, lessons, and blockers to disk.
   */
  proactiveFlush(session: Session, config: AgentConfig): Promise<FlushResult>;

  /**
   * Called before spawning a subagent.
   * Prepares context summary for the subagent's initial state.
   */
  prepareSubagentSpawn(
    session: Session,
    taskDescription: string
  ): Promise<SubagentContext>;

  /**
   * Called when a subagent finishes.
   * Integrates subagent results back into parent context.
   */
  onSubagentEnded(
    session: Session,
    subagentResult: SubagentResult
  ): Promise<void>;
}

// ─── Result Types ───────────────────────────────────────

export interface BootstrapResult {
  /** System prompt with workspace context injected */
  systemPrompt: string;
  /** Bootstrap messages (USER.md content, etc.) */
  bootstrapMessages: Message[];
  /** Token count of bootstrap context */
  tokenCount: number;
}

export interface IngestResult {
  /** The message as stored (may have metadata added) */
  message: Message;
  /** Whether this ingestion should trigger compaction check */
  checkCompaction: boolean;
  /** Estimated token count of the new message */
  tokenCount: number;
}

export interface AssembleResult {
  /** The assembled messages to send to the LLM */
  messages: Message[];
  /** Total token count of the assembled context */
  totalTokens: number;
  /** How many messages were summarized vs raw */
  stats: {
    rawMessageCount: number;
    summarizedBlockCount: number;
    memoryInjectionCount: number;
    skillsMetadataCount: number;
  };
}

export interface CompactResult {
  /** Number of messages compacted in this pass */
  messagesCompacted: number;
  /** DAG nodes created during compaction */
  nodesCreated: DagNode[];
  /** Tokens saved by compaction */
  tokensSaved: number;
  /** Whether further compaction is needed */
  needsMoreCompaction: boolean;
}

export interface FlushResult {
  /** Memories extracted and written to disk */
  memoriesWritten: number;
  /** File path where memories were saved */
  outputPath: string;
  /** Categories of information preserved */
  categories: string[];
}

export interface SubagentContext {
  /** Condensed context for the subagent */
  messages: Message[];
  /** Relevant memory entries */
  memories: string[];
  /** Token budget remaining for the subagent */
  tokenBudget: number;
}

export interface SubagentResult {
  /** The subagent's task description */
  task: string;
  /** The subagent's output */
  output: string;
  /** Any memories the subagent created */
  memories: string[];
  /** Token count of the result */
  tokenCount: number;
}
