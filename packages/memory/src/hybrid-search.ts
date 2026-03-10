/**
 * HybridSearch — weighted fusion of keyword (BM25) and vector search.
 *
 * Combines the precision of keyword matching with the semantic
 * understanding of vector search. Uses Reciprocal Rank Fusion (RRF)
 * for score normalization across the two methods.
 *
 * Graceful degradation:
 * - If embeddings fail → keyword search still works
 * - If keyword search fails → vector search still works
 * - If both fail → you still have the raw Markdown files
 */

import type { MemoryConfig, MemorySearchResult } from "@kyles-openclaw/shared";
import type { Chunk } from "./chunker.js";
import { KeywordSearch } from "./keyword-search.js";
import { VectorSearch, type EmbedFn } from "./vector-search.js";

export class HybridSearch {
  private keywordSearch: KeywordSearch;
  private vectorSearch: VectorSearch;
  private config: MemoryConfig;

  constructor(embedFn: EmbedFn, config: MemoryConfig) {
    this.keywordSearch = new KeywordSearch();
    this.vectorSearch = new VectorSearch(embedFn, config);
    this.config = config;
  }

  /**
   * Index chunks for both keyword and vector search.
   */
  async index(chunks: Chunk[]): Promise<void> {
    // Keyword indexing is synchronous and always works
    this.keywordSearch.index(chunks);

    // Vector indexing may fail (API errors, no key, etc.)
    try {
      await this.vectorSearch.index(chunks);
    } catch (error) {
      console.warn(
        "Vector indexing failed, falling back to keyword-only search:",
        error
      );
    }
  }

  /**
   * Hybrid search combining keyword and vector results.
   * Uses weighted Reciprocal Rank Fusion (RRF) for score merging.
   */
  async search(query: string): Promise<MemorySearchResult[]> {
    const topK = this.config.searchTopK;
    const vectorWeight = this.config.vectorWeight;
    const keywordWeight = this.config.keywordWeight;

    // Run both searches in parallel
    const [keywordResults, vectorResults] = await Promise.allSettled([
      Promise.resolve(this.keywordSearch.search(query, topK * 2)),
      this.vectorSearch.search(query, topK * 2),
    ]);

    // Build a unified score map using RRF
    const scoreMap = new Map<
      string,
      { score: number; chunk: Chunk; method: "vector" | "keyword" | "hybrid" }
    >();

    const rrfK = 60; // RRF constant

    // Process keyword results
    if (keywordResults.status === "fulfilled") {
      keywordResults.value.forEach((result, rank) => {
        const key = chunkKey(result.chunk);
        const rrfScore = keywordWeight / (rrfK + rank + 1);
        const existing = scoreMap.get(key);

        if (existing) {
          existing.score += rrfScore;
          existing.method = "hybrid";
        } else {
          scoreMap.set(key, {
            score: rrfScore,
            chunk: result.chunk,
            method: "keyword",
          });
        }
      });
    }

    // Process vector results
    if (vectorResults.status === "fulfilled") {
      vectorResults.value.forEach((result, rank) => {
        const key = chunkKey(result.chunk);
        const rrfScore = vectorWeight / (rrfK + rank + 1);
        const existing = scoreMap.get(key);

        if (existing) {
          existing.score += rrfScore;
          existing.method = "hybrid";
        } else {
          scoreMap.set(key, {
            score: rrfScore,
            chunk: result.chunk,
            method: "vector",
          });
        }
      });
    }

    // Sort by fused score and return top K
    return [...scoreMap.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map((entry) => ({
        content: entry.chunk.content,
        source: entry.chunk.source,
        score: entry.score,
        method: entry.method,
        chunkIndex: entry.chunk.index,
      }));
  }

  /**
   * Clear caches for a specific source file.
   */
  clearCache(source: string): void {
    this.vectorSearch.clearCache(source);
  }
}

function chunkKey(chunk: Chunk): string {
  return `${chunk.source}:${chunk.startOffset}:${chunk.endOffset}`;
}
