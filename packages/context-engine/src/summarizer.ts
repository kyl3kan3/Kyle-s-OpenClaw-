/**
 * Summarizer — creates depth-aware summaries for DAG nodes.
 *
 * Key improvements over OpenClaw's compaction:
 * 1. Depth-aware prompts: deeper summaries get more aggressive compression
 * 2. Identifier preservation: file paths, URLs, IDs survive summarization
 * 3. Deterministic fallback: if summarization fails, uses extractive fallback
 * 4. Escalation: if a summary isn't shorter, auto-escalates compression level
 */

import type { DagNode, ModelConfig } from "@kyles-openclaw/shared";
import { TokenCounter } from "./token-counter.js";

export type SummarizeFn = (
  prompt: string,
  model: ModelConfig
) => Promise<string>;

export class Summarizer {
  private tokenCounter: TokenCounter;
  private callLLM: SummarizeFn;
  private model: ModelConfig;

  constructor(
    callLLM: SummarizeFn,
    model: ModelConfig,
    tokenCounter?: TokenCounter
  ) {
    this.callLLM = callLLM;
    this.model = model;
    this.tokenCounter = tokenCounter ?? new TokenCounter();
  }

  /**
   * Summarize a block of DAG nodes into a single summary.
   * Depth determines compression aggressiveness.
   */
  async summarize(
    nodes: DagNode[],
    depth: number,
    preserveIdentifiers: boolean
  ): Promise<string> {
    const content = nodes.map((n) => n.content).join("\n\n---\n\n");
    const sourceTokens = this.tokenCounter.count(content);

    // Target: each level of depth compresses to ~40% of input
    const targetRatio = Math.pow(0.4, depth);
    const targetTokens = Math.max(
      50,
      Math.floor(sourceTokens * targetRatio)
    );

    const prompt = this.buildPrompt(content, depth, targetTokens, preserveIdentifiers);

    try {
      let summary = await this.callLLM(prompt, this.model);
      const summaryTokens = this.tokenCounter.count(summary);

      // Escalation: if summary isn't shorter enough, try harder
      if (summaryTokens > targetTokens * 1.5 && depth < 5) {
        summary = await this.escalate(content, targetTokens, preserveIdentifiers);
      }

      return summary;
    } catch {
      // Deterministic fallback: extract first and last sentences
      return this.extractiveFallback(content, targetTokens);
    }
  }

  private buildPrompt(
    content: string,
    depth: number,
    targetTokens: number,
    preserveIdentifiers: boolean
  ): string {
    const identifierInstruction = preserveIdentifiers
      ? `CRITICAL: Preserve ALL opaque identifiers verbatim — file paths, URLs, commit hashes, IDs, branch names, error codes. These must appear exactly as in the original.`
      : "";

    const depthInstructions: Record<number, string> = {
      1: "Create a detailed summary preserving key decisions, actions taken, errors encountered, and their resolutions. Include specific file names, function names, and technical details.",
      2: "Create a condensed summary focusing on high-level decisions, outcomes, and important state changes. Omit step-by-step details but keep critical technical references.",
      3: "Create a brief executive summary. Only include major decisions, final outcomes, and critical blockers. Maximum compression while retaining decision rationale.",
    };

    const instruction =
      depthInstructions[Math.min(depth, 3)] ?? depthInstructions[3];

    return `You are a context compressor for an AI agent. Your job is to summarize conversation history losslessly — the original messages are preserved separately, so focus on making a useful summary.

${instruction}

${identifierInstruction}

Target length: approximately ${targetTokens} tokens.

Format your summary as a structured block:
- Start with "## Context Summary (depth ${depth})"
- Use bullet points for key items
- Group related items under subheadings
- End with "## Active State" listing any ongoing tasks, open questions, or blockers

CONVERSATION TO SUMMARIZE:
${content}`;
  }

  private async escalate(
    content: string,
    targetTokens: number,
    preserveIdentifiers: boolean
  ): Promise<string> {
    const identifierInstruction = preserveIdentifiers
      ? "Preserve identifiers (paths, URLs, IDs) verbatim."
      : "";

    const prompt = `AGGRESSIVE COMPRESSION needed. Summarize this conversation into ${targetTokens} tokens maximum.

Rules:
- Only include: decisions made, final outcomes, critical errors, active blockers
- Skip: reasoning, alternatives considered, intermediate steps
- ${identifierInstruction}

CONTENT:
${content}`;

    return this.callLLM(prompt, this.model);
  }

  private extractiveFallback(content: string, targetTokens: number): string {
    // Take first ~30% and last ~30% of content by character count
    const targetChars = targetTokens * 4;
    const headSize = Math.floor(targetChars * 0.4);
    const tailSize = Math.floor(targetChars * 0.4);

    if (content.length <= targetChars) return content;

    const head = content.slice(0, headSize);
    const tail = content.slice(-tailSize);

    return `## Context Summary (extractive fallback)\n\n**Beginning:**\n${head}\n\n**[... ${content.length - headSize - tailSize} chars omitted ...]**\n\n**End:**\n${tail}`;
  }
}
