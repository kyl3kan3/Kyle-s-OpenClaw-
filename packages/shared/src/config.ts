/**
 * Default configuration for Kyle's OpenClaw.
 */

import type { AgentConfig, ContextConfig, MemoryConfig } from "./types.js";

export const DEFAULT_CONTEXT_CONFIG: ContextConfig = {
  compactionThreshold: 0.75,
  softFlushThreshold: 0.6,
  freshTailCount: 32,
  maxCondensationDepth: -1, // unlimited — DAG cascades as deep as needed
  preserveIdentifiers: true,
  pruningMode: "cache-ttl",
  cacheTtlSeconds: 21600, // 6 hours
};

export const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  memoryDir: "./memory",
  embeddingProvider: "openai",
  embeddingModel: "text-embedding-3-small",
  chunkSize: 700,
  chunkOverlap: 100,
  searchTopK: 10,
  vectorWeight: 0.6,
  keywordWeight: 0.4,
};

export function createDefaultAgentConfig(
  overrides: Partial<AgentConfig> = {}
): AgentConfig {
  return {
    id: "default",
    name: "Kyle's OpenClaw Agent",
    model: {
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      maxTokens: 8192,
      contextWindow: 200000,
    },
    systemPrompt: "You are a helpful AI assistant.",
    tools: [],
    skillsDirs: ["./skills"],
    workspaceDir: "./workspace",
    context: { ...DEFAULT_CONTEXT_CONFIG },
    memory: { ...DEFAULT_MEMORY_CONFIG },
    ...overrides,
  };
}
