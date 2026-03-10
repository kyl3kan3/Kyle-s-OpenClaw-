/**
 * Compactor — performs lossless compaction of conversation history.
 *
 * Unlike OpenClaw's destructive compaction that replaces history with summaries,
 * we build a DAG where every original message is preserved and summaries
 * link back to their sources. The model sees summaries in context but
 * can expand any summary on demand to recover the original.
 *
 * Algorithm (inspired by LCM paper + lossless-claw):
 * 1. Identify oldest messages outside the "fresh tail"
 * 2. Group them into chunks (8-16 messages per chunk)
 * 3. Summarize each chunk → create depth-1 summary nodes
 * 4. If depth-1 summaries accumulate, condense them → depth-2 nodes
 * 5. Continue cascading up to maxCondensationDepth
 */

import type { ContextConfig, DagNode } from "@kyles-openclaw/shared";
import { DagStore } from "./dag-store.js";
import { Summarizer } from "./summarizer.js";
import { TokenCounter } from "./token-counter.js";

export interface CompactionResult {
  nodesCreated: DagNode[];
  tokensSaved: number;
  passesRun: number;
}

export class Compactor {
  private dagStore: DagStore;
  private summarizer: Summarizer;
  private tokenCounter: TokenCounter;
  private config: ContextConfig;

  constructor(
    dagStore: DagStore,
    summarizer: Summarizer,
    config: ContextConfig,
    tokenCounter?: TokenCounter
  ) {
    this.dagStore = dagStore;
    this.summarizer = summarizer;
    this.config = config;
    this.tokenCounter = tokenCounter ?? new TokenCounter();
  }

  /**
   * Run a full compaction pass on a session.
   * Returns the DAG nodes created and tokens saved.
   */
  async compact(
    sessionId: string,
    contextWindow: number
  ): Promise<CompactionResult> {
    const targetTokens = Math.floor(
      contextWindow * this.config.compactionThreshold
    );
    let totalTokensSaved = 0;
    const allNodesCreated: DagNode[] = [];
    let passesRun = 0;

    // Leaf pass: summarize raw messages into depth-1 summaries
    const leafResult = await this.leafPass(sessionId, targetTokens);
    allNodesCreated.push(...leafResult.nodesCreated);
    totalTokensSaved += leafResult.tokensSaved;
    passesRun++;

    // Condensation passes: cascade summaries upward
    if (this.config.maxCondensationDepth !== 0) {
      const maxDepth =
        this.config.maxCondensationDepth === -1
          ? 100
          : this.config.maxCondensationDepth;

      for (let depth = 2; depth <= maxDepth; depth++) {
        const currentRootTokens =
          this.dagStore.getRootTokenCount(sessionId);
        if (currentRootTokens <= targetTokens) break;

        const condResult = await this.condensationPass(
          sessionId,
          depth,
          targetTokens
        );
        if (condResult.nodesCreated.length === 0) break;

        allNodesCreated.push(...condResult.nodesCreated);
        totalTokensSaved += condResult.tokensSaved;
        passesRun++;
      }
    }

    return {
      nodesCreated: allNodesCreated,
      tokensSaved: totalTokensSaved,
      passesRun,
    };
  }

  /**
   * Leaf pass: group raw (depth-0) nodes and summarize them.
   * Protects the freshTailCount most recent raw nodes.
   */
  private async leafPass(
    sessionId: string,
    _targetTokens: number
  ): Promise<CompactionResult> {
    const rawNodes = this.dagStore
      .getNodesAtDepth(sessionId, 0)
      .sort((a, b) => a.createdAt - b.createdAt);

    // Protect the fresh tail
    const compactableCount = Math.max(
      0,
      rawNodes.length - this.config.freshTailCount
    );
    if (compactableCount < 4) {
      return { nodesCreated: [], tokensSaved: 0, passesRun: 0 };
    }

    const toCompact = rawNodes.slice(0, compactableCount);
    return this.summarizeChunks(sessionId, toCompact, 1);
  }

  /**
   * Condensation pass: group nodes at (depth-1) and summarize to depth.
   */
  private async condensationPass(
    sessionId: string,
    depth: number,
    _targetTokens: number
  ): Promise<CompactionResult> {
    const nodesAtPrevDepth = this.dagStore.getNodesAtDepth(
      sessionId,
      depth - 1
    );

    if (nodesAtPrevDepth.length < 3) {
      return { nodesCreated: [], tokensSaved: 0, passesRun: 0 };
    }

    // Keep the most recent 2 nodes at this depth uncondensed
    const toCondense = nodesAtPrevDepth.slice(0, -2);
    if (toCondense.length < 2) {
      return { nodesCreated: [], tokensSaved: 0, passesRun: 0 };
    }

    return this.summarizeChunks(sessionId, toCondense, depth);
  }

  /**
   * Group nodes into chunks and summarize each chunk.
   */
  private async summarizeChunks(
    sessionId: string,
    nodes: DagNode[],
    depth: number
  ): Promise<CompactionResult> {
    // Chunk size: 8-16 nodes depending on their token count
    const chunks = this.chunkNodes(nodes);
    const nodesCreated: DagNode[] = [];
    let tokensSaved = 0;

    for (const chunk of chunks) {
      const chunkTokens = chunk.reduce((sum, n) => sum + n.tokenCount, 0);
      const summary = await this.summarizer.summarize(
        chunk,
        depth,
        this.config.preserveIdentifiers
      );

      const summaryNode = this.dagStore.createSummaryNode(
        sessionId,
        chunk.map((n) => n.id),
        summary,
        depth
      );

      nodesCreated.push(summaryNode);
      tokensSaved += chunkTokens - summaryNode.tokenCount;
    }

    return { nodesCreated, tokensSaved, passesRun: 1 };
  }

  /**
   * Smart chunking: groups nodes into chunks of 8-16,
   * trying to keep related messages together.
   */
  private chunkNodes(nodes: DagNode[]): DagNode[][] {
    const chunks: DagNode[][] = [];
    const targetChunkSize = 12;
    const minChunkSize = 4;

    let current: DagNode[] = [];
    for (const node of nodes) {
      current.push(node);

      if (current.length >= targetChunkSize) {
        chunks.push(current);
        current = [];
      }
    }

    // Handle remainder
    if (current.length >= minChunkSize) {
      chunks.push(current);
    } else if (current.length > 0 && chunks.length > 0) {
      // Merge small remainder into last chunk
      chunks[chunks.length - 1].push(...current);
    } else if (current.length > 0) {
      chunks.push(current);
    }

    return chunks;
  }
}
