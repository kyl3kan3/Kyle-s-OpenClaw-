/**
 * DAG Store — the backbone of lossless context management.
 *
 * Every message is preserved as a raw node. When compaction runs,
 * it creates summary nodes that link back to their source nodes.
 * As summaries accumulate, they get condensed into higher-level nodes,
 * forming a directed acyclic graph (DAG).
 *
 * Nothing is ever deleted. The model can expand any summary
 * back to its original messages on demand.
 *
 * Inspired by lossless-claw (Martian-Engineering) and the LCM paper (Voltropy).
 */

import type { DagNode, DagNodeType, Message } from "@kyles-openclaw/shared";
import { TokenCounter } from "./token-counter.js";

export class DagStore {
  private nodes = new Map<string, DagNode>();
  private sessionIndex = new Map<string, Set<string>>();
  private tokenCounter: TokenCounter;
  private nextId = 0;

  constructor(tokenCounter?: TokenCounter) {
    this.tokenCounter = tokenCounter ?? new TokenCounter();
  }

  private generateId(): string {
    return `dag_${Date.now()}_${this.nextId++}`;
  }

  /**
   * Store a raw message as a leaf node in the DAG.
   */
  addRawMessage(sessionId: string, message: Message): DagNode {
    const node: DagNode = {
      id: this.generateId(),
      sessionId,
      type: "raw",
      depth: 0,
      content: `[${message.role}]: ${message.content}`,
      tokenCount: this.tokenCounter.count(message.content),
      childIds: [],
      sourceMessageIds: [message.id],
      createdAt: Date.now(),
    };

    this.nodes.set(node.id, node);
    this.getSessionNodes(sessionId).add(node.id);
    return node;
  }

  /**
   * Create a summary node from a set of child nodes.
   * The children are NOT deleted — they remain accessible for expansion.
   */
  createSummaryNode(
    sessionId: string,
    childIds: string[],
    summaryContent: string,
    depth: number
  ): DagNode {
    // Collect all source message IDs from children
    const sourceMessageIds: string[] = [];
    for (const childId of childIds) {
      const child = this.nodes.get(childId);
      if (child) {
        sourceMessageIds.push(...child.sourceMessageIds);
      }
    }

    const type: DagNodeType = depth === 1 ? "summary" : "condensed";
    const node: DagNode = {
      id: this.generateId(),
      sessionId,
      type,
      depth,
      content: summaryContent,
      tokenCount: this.tokenCounter.count(summaryContent),
      childIds,
      sourceMessageIds: [...new Set(sourceMessageIds)],
      createdAt: Date.now(),
    };

    this.nodes.set(node.id, node);
    this.getSessionNodes(sessionId).add(node.id);
    return node;
  }

  /**
   * Get the root nodes of the DAG for a session —
   * these are the highest-level summaries that cover all history.
   */
  getRootNodes(sessionId: string): DagNode[] {
    const nodeIds = this.getSessionNodes(sessionId);
    const childOfSomeone = new Set<string>();

    for (const nodeId of nodeIds) {
      const node = this.nodes.get(nodeId);
      if (node) {
        for (const childId of node.childIds) {
          childOfSomeone.add(childId);
        }
      }
    }

    const roots: DagNode[] = [];
    for (const nodeId of nodeIds) {
      if (!childOfSomeone.has(nodeId)) {
        const node = this.nodes.get(nodeId);
        if (node) roots.push(node);
      }
    }

    return roots.sort((a, b) => a.createdAt - b.createdAt);
  }

  /**
   * Expand a summary node — returns its immediate children.
   * This is how the model "drills down" into compacted history.
   */
  expand(nodeId: string): DagNode[] {
    const node = this.nodes.get(nodeId);
    if (!node) return [];
    return node.childIds
      .map((id) => this.nodes.get(id))
      .filter((n): n is DagNode => n !== undefined)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  /**
   * Expand all the way to raw messages — full recovery of original content.
   */
  expandToRaw(nodeId: string): DagNode[] {
    const node = this.nodes.get(nodeId);
    if (!node) return [];
    if (node.type === "raw") return [node];

    const rawNodes: DagNode[] = [];
    for (const childId of node.childIds) {
      rawNodes.push(...this.expandToRaw(childId));
    }
    return rawNodes.sort((a, b) => a.createdAt - b.createdAt);
  }

  /**
   * Search across all DAG nodes using simple text matching.
   * For full semantic search, use the Memory system instead.
   */
  grep(sessionId: string, query: string): DagNode[] {
    const results: DagNode[] = [];
    const queryLower = query.toLowerCase();
    const nodeIds = this.getSessionNodes(sessionId);

    for (const nodeId of nodeIds) {
      const node = this.nodes.get(nodeId);
      if (node && node.content.toLowerCase().includes(queryLower)) {
        results.push(node);
      }
    }

    return results.sort((a, b) => a.createdAt - b.createdAt);
  }

  /**
   * Describe a node — returns a one-line summary of what it covers.
   */
  describe(nodeId: string): string {
    const node = this.nodes.get(nodeId);
    if (!node) return "Node not found";

    const childCount = node.childIds.length;
    const sourceCount = node.sourceMessageIds.length;

    switch (node.type) {
      case "raw":
        return `Raw message (${node.tokenCount} tokens)`;
      case "summary":
        return `Summary of ${childCount} messages covering ${sourceCount} original messages (${node.tokenCount} tokens)`;
      case "condensed":
        return `Condensed summary (depth ${node.depth}) covering ${sourceCount} original messages (${node.tokenCount} tokens)`;
    }
  }

  /**
   * Get all nodes at a specific depth for a session.
   */
  getNodesAtDepth(sessionId: string, depth: number): DagNode[] {
    const results: DagNode[] = [];
    const nodeIds = this.getSessionNodes(sessionId);

    for (const nodeId of nodeIds) {
      const node = this.nodes.get(nodeId);
      if (node && node.depth === depth) {
        results.push(node);
      }
    }

    return results.sort((a, b) => a.createdAt - b.createdAt);
  }

  /**
   * Get total token count of root-level nodes (what the model sees).
   */
  getRootTokenCount(sessionId: string): number {
    return this.getRootNodes(sessionId).reduce(
      (sum, node) => sum + node.tokenCount,
      0
    );
  }

  /**
   * Get statistics about the DAG for a session.
   */
  getStats(sessionId: string): DagStats {
    const nodeIds = this.getSessionNodes(sessionId);
    let rawCount = 0;
    let summaryCount = 0;
    let condensedCount = 0;
    let totalTokens = 0;
    let maxDepth = 0;

    for (const nodeId of nodeIds) {
      const node = this.nodes.get(nodeId);
      if (!node) continue;
      totalTokens += node.tokenCount;
      maxDepth = Math.max(maxDepth, node.depth);
      switch (node.type) {
        case "raw":
          rawCount++;
          break;
        case "summary":
          summaryCount++;
          break;
        case "condensed":
          condensedCount++;
          break;
      }
    }

    return {
      rawCount,
      summaryCount,
      condensedCount,
      totalNodes: nodeIds.size,
      totalTokens,
      rootTokens: this.getRootTokenCount(sessionId),
      maxDepth,
    };
  }

  getNode(nodeId: string): DagNode | undefined {
    return this.nodes.get(nodeId);
  }

  private getSessionNodes(sessionId: string): Set<string> {
    if (!this.sessionIndex.has(sessionId)) {
      this.sessionIndex.set(sessionId, new Set());
    }
    return this.sessionIndex.get(sessionId)!;
  }

  /**
   * Export all nodes for persistence.
   */
  export(): DagNode[] {
    return [...this.nodes.values()];
  }

  /**
   * Import nodes from persistence.
   */
  import(nodes: DagNode[]): void {
    for (const node of nodes) {
      this.nodes.set(node.id, node);
      this.getSessionNodes(node.sessionId).add(node.id);
    }
  }
}

export interface DagStats {
  rawCount: number;
  summaryCount: number;
  condensedCount: number;
  totalNodes: number;
  totalTokens: number;
  rootTokens: number;
  maxDepth: number;
}
