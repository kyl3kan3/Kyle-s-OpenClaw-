# Kyle's OpenClaw

An OpenClaw-inspired AI agent framework with **lossless context management** built-in from day one.

## The Context Problem (and How We Fix It)

Every AI agent framework struggles with context. When conversations get long, you hit the context window limit and have to compress. OpenClaw uses compaction — summarizing old messages and replacing them. The problem? **Information is destroyed.** The agent forgets details, loses track of decisions, and the user has to repeat themselves.

**Kyle's OpenClaw solves this with a DAG-based lossless context engine:**

| Feature | OpenClaw Default | Kyle's OpenClaw |
|---------|-----------------|-----------------|
| Compaction | Destructive — replaces history with summaries | **Lossless** — summaries link back to preserved originals |
| Memory flush | Reactive — only before compaction | **Proactive** — checkpoints at 60% capacity |
| Pruning | Blind — removes old tool results | **Semantic** — keeps results referenced by conversation |
| Depth | Single-level summaries | **Cascading DAG** — unlimited depth condensation |
| Recovery | Gone forever | **Full expansion** — `lcm_expand` recovers originals |
| Search | Separate memory system | **Unified** — `lcm_grep` searches all history |

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                        Gateway                            │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐       │
│  │   CLI   │ │WebSocket│ │  Slack  │ │ Discord │  ...   │
│  └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘       │
│       └───────────┴───────────┴───────────┘              │
│                    Channel Router                         │
│              (multi-agent routing)                        │
└──────────────────────┬───────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────┐
│                   Agent Runtime                           │
│  ┌──────────────────────────────────────────────────┐    │
│  │             Lossless Context Engine                │    │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐          │    │
│  │  │ DAG Store│ │Compactor │ │Assembler │          │    │
│  │  │(raw→sum→ │ │(leaf +   │ │(DAG roots│          │    │
│  │  │condensed)│ │condense) │ │+memory+  │          │    │
│  │  │          │ │          │ │fresh tail│          │    │
│  │  └──────────┘ └──────────┘ └──────────┘          │    │
│  │  ┌──────────┐ ┌──────────┐                        │    │
│  │  │Summarizer│ │  Pruner  │                        │    │
│  │  │(depth-   │ │(semantic │                        │    │
│  │  │aware)    │ │+ TTL)    │                        │    │
│  │  └──────────┘ └──────────┘                        │    │
│  └──────────────────────────────────────────────────┘    │
│                                                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │Memory System │  │ Tool Registry│  │Skills Loader │   │
│  │(hybrid BM25+ │  │(lcm_expand,  │  │(metadata-    │   │
│  │vector search)│  │grep,describe)│  │only inject)  │   │
│  └──────────────┘  └──────────────┘  └──────────────┘   │
└──────────────────────────────────────────────────────────┘
```

## How Lossless Context Works

```
Turn 1-50 (raw messages in fresh tail)
  │
  ▼ compaction triggered at 75% capacity
  │
Turn 1-20 → Summary A (depth 1) ─── children: [msg1..msg20]
Turn 21-40 → Summary B (depth 1) ── children: [msg21..msg40]
Turn 41-50 (still in fresh tail, protected)
  │
  ▼ more messages, summaries accumulate
  │
Summary A + B → Condensed C (depth 2) ── children: [A, B]
Summary D (depth 1) ── children: [msg41..msg60]
Turn 61-80 (fresh tail)

The model sees: [Condensed C] + [Summary D] + [Turn 61-80]
But can run: lcm_expand("C") → [Summary A, Summary B]
             lcm_expand("A") → [msg1, msg2, ..., msg20]
```

**Nothing is ever deleted. The DAG just grows deeper.**

## Packages

| Package | Description |
|---------|-------------|
| `@kyles-openclaw/shared` | Core types, ContextEngine interface, EventBus, config |
| `@kyles-openclaw/context-engine` | Lossless DAG engine, compactor, assembler, summarizer, pruner |
| `@kyles-openclaw/memory` | File-based memory with hybrid BM25 + vector search |
| `@kyles-openclaw/agent-runtime` | Agent loop, session management, tool registry, skills loader |
| `@kyles-openclaw/gateway` | Message router, channel adapters, multi-agent routing |
| `@kyles-openclaw/tools` | Built-in tools (file ops, browser, cron) |
| `@kyles-openclaw/skills` | Bundled skills (web search, memory management, context inspection) |
| `@kyles-openclaw/cli` | CLI entry point and terminal adapter |

## Quick Start

```bash
# Install dependencies
pnpm install

# Start with Anthropic
ANTHROPIC_API_KEY=your-key pnpm dev

# Or with OpenAI
OPENAI_API_KEY=your-key pnpm dev
```

## Inspired By

- [OpenClaw](https://github.com/openclaw/openclaw) — The original personal AI assistant (68k+ stars)
- [lossless-claw](https://github.com/Martian-Engineering/lossless-claw) — LCM plugin for OpenClaw
- [LCM Paper](https://papers.voltropy.com/LCM) — Lossless Context Management by Voltropy
- OpenClaw v2026.3.7's ContextEngine plugin architecture

## License

MIT
