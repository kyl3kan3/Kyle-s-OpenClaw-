/**
 * VectorSearch — embedding-based semantic search over memory chunks.
 *
 * Supports multiple embedding providers (OpenAI, local, Gemini, Voyage)
 * with automatic fallback. Embeddings are cached to avoid re-embedding
 * unchanged content.
 *
 * Unlike OpenClaw which requires sqlite-vec, we start with a pure
 * in-memory implementation using cosine similarity. This means
 * zero dependencies — it just works.
 */

import type { Chunk } from "./chunker.js";
import type { MemoryConfig } from "@kyles-openclaw/shared";

export type EmbedFn = (texts: string[]) => Promise<number[][]>;

export interface VectorResult {
  chunk: Chunk;
  score: number;
}

export class VectorSearch {
  private embeddings = new Map<string, number[]>();
  private chunks: Chunk[] = [];
  private embedFn: EmbedFn;
  private _config: MemoryConfig;

  constructor(embedFn: EmbedFn, config: MemoryConfig) {
    this.embedFn = embedFn;
    this._config = config;
  }

  /**
   * Index chunks by computing their embeddings.
   * Caches embeddings keyed by content hash to avoid re-computation.
   */
  async index(chunks: Chunk[]): Promise<void> {
    this.chunks = chunks;

    // Find chunks that need embedding
    const needsEmbedding: Array<{ chunk: Chunk; index: number }> = [];
    for (let i = 0; i < chunks.length; i++) {
      const key = this.contentKey(chunks[i]);
      if (!this.embeddings.has(key)) {
        needsEmbedding.push({ chunk: chunks[i], index: i });
      }
    }

    if (needsEmbedding.length === 0) return;

    // Batch embed (most APIs support batch embedding)
    const texts = needsEmbedding.map((e) => e.chunk.content);
    const batchSize = 100;

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const embeddings = await this.embedFn(batch);

      for (let j = 0; j < embeddings.length; j++) {
        const chunk = needsEmbedding[i + j].chunk;
        this.embeddings.set(this.contentKey(chunk), embeddings[j]);
      }
    }
  }

  /**
   * Search by semantic similarity using cosine distance.
   */
  async search(query: string, topK = 10): Promise<VectorResult[]> {
    const [queryEmbedding] = await this.embedFn([query]);
    if (!queryEmbedding) return [];

    const scored: VectorResult[] = [];

    for (const chunk of this.chunks) {
      const embedding = this.embeddings.get(this.contentKey(chunk));
      if (!embedding) continue;

      const score = this.cosineSimilarity(queryEmbedding, embedding);
      scored.push({ chunk, score });
    }

    return scored.sort((a, b) => b.score - a.score).slice(0, topK);
  }

  /**
   * Cosine similarity between two vectors.
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    if (denominator === 0) return 0;
    return dotProduct / denominator;
  }

  private contentKey(chunk: Chunk): string {
    // Simple hash based on source + offset for cache keying
    return `${chunk.source}:${chunk.startOffset}:${chunk.endOffset}`;
  }

  /**
   * Clear embedding cache for a specific source (when file changes).
   */
  clearCache(source: string): void {
    for (const [key] of this.embeddings) {
      if (key.startsWith(source + ":")) {
        this.embeddings.delete(key);
      }
    }
  }
}
