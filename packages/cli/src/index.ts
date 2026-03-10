#!/usr/bin/env node

/**
 * Kyle's OpenClaw — CLI Entry Point
 *
 * Starts the gateway with a CLI adapter and a single agent runtime
 * configured with the LosslessContextEngine.
 *
 * Usage:
 *   pnpm dev                          # Start with default config
 *   ANTHROPIC_API_KEY=sk-... pnpm dev # Start with Anthropic
 *   OPENAI_API_KEY=sk-... pnpm dev    # Start with OpenAI
 */

import { createDefaultAgentConfig } from "@kyles-openclaw/shared";
import { AgentRuntime } from "@kyles-openclaw/agent-runtime";
import { Gateway } from "@kyles-openclaw/gateway";
import { CLIAdapter } from "./cli-adapter.js";

async function main() {
  const provider = process.env.OPENAI_API_KEY ? "openai" : "anthropic";
  const apiKey =
    process.env.ANTHROPIC_API_KEY ?? process.env.OPENAI_API_KEY ?? "";

  const config = createDefaultAgentConfig({
    model: {
      provider,
      model:
        provider === "anthropic"
          ? "claude-sonnet-4-20250514"
          : "gpt-4o",
      apiKey,
      maxTokens: 8192,
      contextWindow: 200000,
    },
    systemPrompt: `You are Kyle's OpenClaw, a helpful AI assistant with lossless context management.

You have access to special context tools:
- lcm_expand: Drill into summarized history to see original messages
- lcm_grep: Search across all history including compacted
- lcm_describe: Get metadata about a context node
- memory_search: Search long-term memory files

Your context is managed by a DAG-based lossless engine. When old messages are compacted,
they become summaries — but the originals are preserved. You can expand any summary
to recover full detail. Nothing is ever lost.`,
    workspaceDir: process.env.OPENCLAW_WORKSPACE ?? "./workspace",
    memory: {
      memoryDir: process.env.OPENCLAW_MEMORY_DIR ?? "./workspace/memory",
      embeddingProvider: "openai",
      embeddingModel: "text-embedding-3-small",
      chunkSize: 700,
      chunkOverlap: 100,
      searchTopK: 10,
      vectorWeight: 0.6,
      keywordWeight: 0.4,
    },
  });

  // Stub LLM call — replace with actual API integration
  const callLLM: Parameters<typeof AgentRuntime>[0]["callLLM"] = async (
    messages,
    _tools,
    _config
  ) => {
    // This is a placeholder. In production, this would call
    // the Anthropic or OpenAI API.
    if (!apiKey) {
      return {
        content: `[No API key set. Set ANTHROPIC_API_KEY or OPENAI_API_KEY to connect to an LLM.]

I received your message: "${messages[messages.length - 1]?.content}"

To make me functional, start with:
  ANTHROPIC_API_KEY=your-key pnpm dev`,
      };
    }

    // Actual API call would go here
    return {
      content:
        "LLM integration pending — the framework is ready, connect your API key.",
    };
  };

  // Stub embedding function
  const embedFn = async (texts: string[]): Promise<number[][]> => {
    // Placeholder: random embeddings for development
    // In production, this calls the embedding API
    return texts.map(() =>
      Array.from({ length: 256 }, () => Math.random() - 0.5)
    );
  };

  // Create the CLI adapter
  const cliAdapter = new CLIAdapter();

  // Create the agent runtime
  const runtime = new AgentRuntime({
    config,
    callLLM,
    embedFn,
    onOutbound: async (message) => {
      await cliAdapter.send(message);
    },
  });

  // Create and start the gateway
  const gateway = new Gateway(config.id);
  gateway.addAdapter(cliAdapter);
  gateway.addAgent(config.id, runtime);

  // Log context engine events
  runtime.getEventBus().on("context:compaction_completed", (event) => {
    console.log("\n📦 Context compacted:", event.payload);
  });

  runtime.getEventBus().on("context:flush_completed", (event) => {
    console.log("\n💾 Memory flushed:", event.payload);
  });

  await gateway.start();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
