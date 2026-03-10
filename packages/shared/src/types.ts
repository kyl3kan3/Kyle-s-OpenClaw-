/**
 * Core types for Kyle's OpenClaw — an AI agent framework
 * with lossless context management built-in from day one.
 */

// ─── Messages ───────────────────────────────────────────

export type Role = "user" | "assistant" | "system" | "tool";

export interface Message {
  id: string;
  role: Role;
  content: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
  /** ID of the tool call this result belongs to */
  toolCallId?: string;
  /** Tool calls requested by the assistant */
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  content: string;
  isError?: boolean;
}

// ─── Session ────────────────────────────────────────────

export interface Session {
  id: string;
  agentId: string;
  channelId: string;
  createdAt: number;
  lastActiveAt: number;
  /** Full raw transcript — never mutated by compaction */
  transcript: Message[];
  /** Compaction metadata */
  compaction?: CompactionState;
}

export interface CompactionState {
  /** Number of compaction passes applied */
  passCount: number;
  /** Token count at last compaction */
  tokenCountAtCompaction: number;
  /** Timestamp of last compaction */
  lastCompactedAt: number;
}

// ─── DAG Node (Lossless Context) ────────────────────────

export type DagNodeType = "raw" | "summary" | "condensed";

export interface DagNode {
  id: string;
  sessionId: string;
  type: DagNodeType;
  /** Depth in the DAG: 0 = raw messages, 1 = first summary, 2+ = condensed */
  depth: number;
  content: string;
  tokenCount: number;
  /** IDs of the child nodes this was summarized from */
  childIds: string[];
  /** IDs of the original raw message IDs reachable from this node */
  sourceMessageIds: string[];
  createdAt: number;
}

// ─── Agent ──────────────────────────────────────────────

export interface AgentConfig {
  id: string;
  name: string;
  model: ModelConfig;
  systemPrompt: string;
  /** Tools available to this agent */
  tools: string[];
  /** Skills directories to load metadata from */
  skillsDirs: string[];
  /** Workspace directory for memory, skills, etc. */
  workspaceDir: string;
  /** Context engine configuration */
  context: ContextConfig;
  /** Memory configuration */
  memory: MemoryConfig;
}

export interface ModelConfig {
  provider: "anthropic" | "openai" | "local";
  model: string;
  apiKey?: string;
  baseUrl?: string;
  maxTokens: number;
  /** Context window size in tokens */
  contextWindow: number;
  temperature?: number;
}

export interface ContextConfig {
  /** Fraction of context window that triggers compaction (default: 0.75) */
  compactionThreshold: number;
  /** Fraction of context window that triggers pre-compaction memory flush (default: 0.6) */
  softFlushThreshold: number;
  /** Number of recent messages to protect from compaction */
  freshTailCount: number;
  /** Max condensation depth (-1 = unlimited) */
  maxCondensationDepth: number;
  /** Model to use for summarization (defaults to agent model) */
  summarizationModel?: ModelConfig;
  /** Whether to preserve opaque identifiers in summaries */
  preserveIdentifiers: boolean;
  /** Pruning mode: "off" | "cache-ttl" | "aggressive" */
  pruningMode: "off" | "cache-ttl" | "aggressive";
  /** Cache TTL in seconds for cache-ttl pruning mode */
  cacheTtlSeconds: number;
}

export interface MemoryConfig {
  /** Directory for memory files (default: workspace/memory/) */
  memoryDir: string;
  /** Embedding provider */
  embeddingProvider: "openai" | "local" | "gemini" | "voyage";
  /** Embedding model name */
  embeddingModel: string;
  /** Max chunk size in characters for indexing */
  chunkSize: number;
  /** Chunk overlap in characters */
  chunkOverlap: number;
  /** Number of results to return from memory search */
  searchTopK: number;
  /** Weight for vector search in hybrid scoring (0-1) */
  vectorWeight: number;
  /** Weight for keyword search in hybrid scoring (0-1) */
  keywordWeight: number;
}

// ─── Channel ────────────────────────────────────────────

export type ChannelType =
  | "cli"
  | "websocket"
  | "slack"
  | "discord"
  | "telegram"
  | "whatsapp"
  | "webhook";

export interface Channel {
  id: string;
  type: ChannelType;
  /** Route to a specific agent */
  agentId: string;
  metadata?: Record<string, unknown>;
}

export interface InboundMessage {
  channelId: string;
  channelType: ChannelType;
  senderId: string;
  content: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface OutboundMessage {
  channelId: string;
  content: string;
  metadata?: Record<string, unknown>;
}

// ─── Tools ──────────────────────────────────────────────

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<ToolResult>;
}

// ─── Skills ─────────────────────────────────────────────

export interface SkillMetadata {
  name: string;
  description: string;
  /** Path to the SKILL.md file */
  path: string;
  /** Trigger patterns that activate this skill */
  triggers?: string[];
}

// ─── Memory Search ──────────────────────────────────────

export interface MemorySearchResult {
  content: string;
  source: string;
  score: number;
  /** Which search method found this */
  method: "vector" | "keyword" | "hybrid";
  chunkIndex: number;
}

export interface MemoryEntry {
  id: string;
  content: string;
  source: string;
  scope: "user" | "session";
  createdAt: number;
  embedding?: number[];
}
