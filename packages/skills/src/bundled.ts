/**
 * Bundled skills — create the default skills directory structure.
 */

import { mkdir, writeFile } from "fs/promises";
import { join } from "path";

export async function createBundledSkillsDir(baseDir: string): Promise<void> {
  const skillsDir = join(baseDir, "skills");

  // Web search skill
  const webSearchDir = join(skillsDir, "web-search");
  await mkdir(webSearchDir, { recursive: true });
  await writeFile(
    join(webSearchDir, "SKILL.md"),
    `---
name: Web Search
description: Search the web for current information and documentation
triggers:
  - search
  - look up
  - find online
---

# Web Search Skill

Use the \`browser_fetch\` tool to retrieve web content.

## Usage
1. Construct a search URL or direct URL
2. Fetch the content
3. Extract relevant information
4. Cite your sources

## Tips
- Use DuckDuckGo for search: \`https://html.duckduckgo.com/html/?q=your+query\`
- For documentation, go directly to the docs site
- Always summarize findings, don't dump raw HTML
`,
    "utf-8"
  );

  // Memory management skill
  const memoryDir = join(skillsDir, "memory-management");
  await mkdir(memoryDir, { recursive: true });
  await writeFile(
    join(memoryDir, "SKILL.md"),
    `---
name: Memory Management
description: Manage long-term memory - save, search, and organize knowledge
triggers:
  - remember
  - recall
  - save to memory
---

# Memory Management Skill

## Saving Memories
Use \`write_file\` to save important information to the memory directory:
- Decisions and their rationale
- Configuration details
- User preferences
- Lessons learned from errors

## Searching Memories
Use \`memory_search\` with natural language queries to find relevant past context.

## Organization
- Daily files: \`memory/YYYY-MM-DD.md\` — auto-created by context flush
- Curated: \`memory/MEMORY.md\` — manually organized important facts
- Topic files: \`memory/topic-name.md\` — deep knowledge on specific topics
`,
    "utf-8"
  );

  // Context inspection skill
  const contextDir = join(skillsDir, "context-inspect");
  await mkdir(contextDir, { recursive: true });
  await writeFile(
    join(contextDir, "SKILL.md"),
    `---
name: Context Inspector
description: Inspect and navigate the lossless context DAG
triggers:
  - show context
  - what did we discuss
  - history
---

# Context Inspector Skill

## Available Tools
- \`lcm_expand(nodeId)\`: Drill into a summary to see original messages
- \`lcm_grep(query)\`: Search all history including compacted
- \`lcm_describe(nodeId)\`: Get metadata about a context node

## When to Use
- User asks "what did we talk about earlier?"
- You need to recall a specific detail from compacted history
- You want to verify a decision made earlier in the conversation

## Tips
- Start with \`lcm_grep\` to find relevant nodes
- Use \`lcm_describe\` to understand what a node covers
- Use \`lcm_expand\` to get the full original messages
- You can chain expansions: expand a condensed node to get summaries, then expand a summary to get raw messages
`,
    "utf-8"
  );
}
