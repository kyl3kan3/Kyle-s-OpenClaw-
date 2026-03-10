/**
 * Pruner — reduces bloat without destroying conversation context.
 *
 * Unlike compaction (which is persistent), pruning is an in-memory
 * transformation applied per-request. It doesn't rewrite the transcript.
 *
 * Modes:
 * - "off": No pruning
 * - "cache-ttl": Remove tool results older than cacheTtlSeconds
 *   (works with Anthropic's prompt caching to reduce cache write costs)
 * - "aggressive": Remove all tool results except the most recent N
 *
 * Improvement over OpenClaw: semantic-aware pruning that keeps
 * tool results referenced by recent conversation, even if old.
 */

import type { Message, ContextConfig } from "@kyles-openclaw/shared";

export class Pruner {
  private config: ContextConfig;

  constructor(config: ContextConfig) {
    this.config = config;
  }

  /**
   * Prune messages in-memory for a single LLM request.
   * Does NOT modify the original transcript.
   */
  prune(messages: Message[]): Message[] {
    switch (this.config.pruningMode) {
      case "off":
        return messages;
      case "cache-ttl":
        return this.pruneByCacheTtl(messages);
      case "aggressive":
        return this.pruneAggressive(messages);
    }
  }

  /**
   * Cache-TTL pruning: replace old tool results with placeholders.
   * Keeps the tool call but replaces the result content with a short note.
   */
  private pruneByCacheTtl(messages: Message[]): Message[] {
    const now = Date.now();
    const ttlMs = this.config.cacheTtlSeconds * 1000;
    const referencedToolCallIds = this.findReferencedToolCalls(messages);

    return messages.map((msg) => {
      if (msg.role !== "tool") return msg;
      if (!msg.toolCallId) return msg;

      // Keep if within TTL
      if (now - msg.timestamp < ttlMs) return msg;

      // Keep if referenced by recent conversation
      if (referencedToolCallIds.has(msg.toolCallId)) return msg;

      // Prune: replace with compact placeholder
      return {
        ...msg,
        content: `[Tool result pruned — original was ${msg.content.length} chars. Use lcm_expand to recover if needed.]`,
      };
    });
  }

  /**
   * Aggressive pruning: only keep the most recent tool results.
   */
  private pruneAggressive(messages: Message[]): Message[] {
    const toolMessages = messages.filter((m) => m.role === "tool");
    const keepCount = Math.min(10, toolMessages.length);
    const toolsToKeep = new Set(
      toolMessages.slice(-keepCount).map((m) => m.toolCallId)
    );

    return messages.map((msg) => {
      if (msg.role !== "tool") return msg;
      if (toolsToKeep.has(msg.toolCallId)) return msg;
      return {
        ...msg,
        content: `[Tool result pruned — ${msg.content.length} chars. Use lcm_expand to recover.]`,
      };
    });
  }

  /**
   * Find tool call IDs that are referenced in recent assistant/user messages.
   * This prevents pruning tool results that the conversation still refers to.
   */
  private findReferencedToolCalls(messages: Message[]): Set<string> {
    const referenced = new Set<string>();
    // Look at the last 20 non-tool messages for references
    const recentMessages = messages
      .filter((m) => m.role !== "tool")
      .slice(-20);

    const toolCallIds = messages
      .filter((m) => m.toolCallId)
      .map((m) => m.toolCallId!);

    for (const msg of recentMessages) {
      for (const toolCallId of toolCallIds) {
        if (msg.content.includes(toolCallId)) {
          referenced.add(toolCallId);
        }
      }
    }

    return referenced;
  }
}
