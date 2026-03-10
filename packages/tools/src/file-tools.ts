/**
 * File tools — read, write, list files in the workspace.
 */

import type { ToolDefinition } from "@kyles-openclaw/shared";
import { readFile, writeFile, readdir } from "fs/promises";
import { join } from "path";

export function createFileTools(workspaceDir: string): ToolDefinition[] {
  return [
    {
      name: "read_file",
      description: "Read the contents of a file from the workspace.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path to the file" },
        },
        required: ["path"],
      },
      execute: async (args) => {
        try {
          const fullPath = join(workspaceDir, args.path as string);
          const content = await readFile(fullPath, "utf-8");
          return { toolCallId: "", content };
        } catch (error) {
          return {
            toolCallId: "",
            content: `Error reading file: ${error instanceof Error ? error.message : String(error)}`,
            isError: true,
          };
        }
      },
    },
    {
      name: "write_file",
      description: "Write content to a file in the workspace.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path to the file" },
          content: { type: "string", description: "Content to write" },
        },
        required: ["path", "content"],
      },
      execute: async (args) => {
        try {
          const fullPath = join(workspaceDir, args.path as string);
          await writeFile(fullPath, args.content as string, "utf-8");
          return { toolCallId: "", content: `File written: ${args.path}` };
        } catch (error) {
          return {
            toolCallId: "",
            content: `Error writing file: ${error instanceof Error ? error.message : String(error)}`,
            isError: true,
          };
        }
      },
    },
    {
      name: "list_files",
      description: "List files in a directory within the workspace.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Relative directory path (default: root)",
          },
        },
      },
      execute: async (args) => {
        try {
          const fullPath = join(workspaceDir, (args.path as string) ?? ".");
          const entries = await readdir(fullPath, { withFileTypes: true });
          const listing = entries
            .map((e) => `${e.isDirectory() ? "📁" : "📄"} ${e.name}`)
            .join("\n");
          return { toolCallId: "", content: listing || "(empty directory)" };
        } catch (error) {
          return {
            toolCallId: "",
            content: `Error listing directory: ${error instanceof Error ? error.message : String(error)}`,
            isError: true,
          };
        }
      },
    },
  ];
}
