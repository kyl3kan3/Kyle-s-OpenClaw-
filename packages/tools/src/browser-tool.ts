/**
 * Browser tool — fetch and extract content from URLs.
 * A simple implementation for web browsing capability.
 */

import type { ToolDefinition } from "@kyles-openclaw/shared";

export function createBrowserTool(): ToolDefinition {
  return {
    name: "browser_fetch",
    description:
      "Fetch a URL and return its text content. Useful for reading documentation, APIs, and web pages.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "The URL to fetch" },
      },
      required: ["url"],
    },
    execute: async (args) => {
      try {
        const response = await fetch(args.url as string);
        const text = await response.text();
        // Truncate to avoid blowing up context
        const maxLength = 10000;
        const truncated =
          text.length > maxLength
            ? text.slice(0, maxLength) + `\n\n[Truncated — ${text.length} total chars]`
            : text;
        return { toolCallId: "", content: truncated };
      } catch (error) {
        return {
          toolCallId: "",
          content: `Error fetching URL: ${error instanceof Error ? error.message : String(error)}`,
          isError: true,
        };
      }
    },
  };
}
