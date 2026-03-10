/**
 * ToolRegistry — manages available tools for the agent.
 *
 * Tools are registered with their definition and execute function.
 * The registry provides the tool schemas for LLM function calling
 * and dispatches tool calls to the right handler.
 *
 * Built-in tools:
 * - lcm_expand: Expand a DAG summary node
 * - lcm_grep: Search compacted history
 * - lcm_describe: Get metadata about a DAG node
 * - memory_search: Search long-term memory files
 * - read_file: Read a file from the workspace
 * - write_file: Write a file to the workspace
 */

import type { ToolDefinition, ToolResult, ToolCall } from "@kyles-openclaw/shared";

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  /**
   * Register a tool.
   */
  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  /**
   * Register multiple tools.
   */
  registerAll(tools: ToolDefinition[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  /**
   * Execute a tool call.
   */
  async execute(toolCall: ToolCall): Promise<ToolResult> {
    const tool = this.tools.get(toolCall.name);
    if (!tool) {
      return {
        toolCallId: toolCall.id,
        content: `Error: Unknown tool "${toolCall.name}". Available tools: ${this.getToolNames().join(", ")}`,
        isError: true,
      };
    }

    try {
      const result = await tool.execute(toolCall.arguments);
      return { ...result, toolCallId: toolCall.id };
    } catch (error) {
      return {
        toolCallId: toolCall.id,
        content: `Error executing tool "${toolCall.name}": ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      };
    }
  }

  /**
   * Get tool definitions for LLM function calling schema.
   */
  getDefinitions(): Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }> {
    return [...this.tools.values()].map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));
  }

  /**
   * Get all registered tool names.
   */
  getToolNames(): string[] {
    return [...this.tools.keys()];
  }

  /**
   * Check if a tool exists.
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }
}
