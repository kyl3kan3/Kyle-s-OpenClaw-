/**
 * KeywordSearch — BM25-based keyword search over memory chunks.
 *
 * A pure TypeScript implementation of BM25 scoring, providing
 * the keyword half of our hybrid search. Works without any
 * external database — everything runs in-memory.
 *
 * This is the fallback that always works, even if embeddings fail.
 */

import type { Chunk } from "./chunker.js";

export interface KeywordResult {
  chunk: Chunk;
  score: number;
  matchedTerms: string[];
}

export class KeywordSearch {
  private documents: Chunk[] = [];
  private termFrequency = new Map<string, Map<number, number>>();
  private documentFrequency = new Map<string, number>();
  private documentLengths: number[] = [];
  private avgDocLength = 0;

  // BM25 parameters
  private k1 = 1.5;
  private b = 0.75;

  /**
   * Index a set of chunks for keyword search.
   */
  index(chunks: Chunk[]): void {
    this.documents = chunks;
    this.termFrequency.clear();
    this.documentFrequency.clear();
    this.documentLengths = [];

    let totalLength = 0;

    for (let i = 0; i < chunks.length; i++) {
      const terms = this.tokenize(chunks[i].content);
      this.documentLengths[i] = terms.length;
      totalLength += terms.length;

      const termCounts = new Map<string, number>();
      const seenTerms = new Set<string>();

      for (const term of terms) {
        termCounts.set(term, (termCounts.get(term) ?? 0) + 1);
        seenTerms.add(term);
      }

      for (const [term, count] of termCounts) {
        if (!this.termFrequency.has(term)) {
          this.termFrequency.set(term, new Map());
        }
        this.termFrequency.get(term)!.set(i, count);
      }

      for (const term of seenTerms) {
        this.documentFrequency.set(
          term,
          (this.documentFrequency.get(term) ?? 0) + 1
        );
      }
    }

    this.avgDocLength =
      chunks.length > 0 ? totalLength / chunks.length : 0;
  }

  /**
   * Search indexed chunks using BM25 scoring.
   */
  search(query: string, topK = 10): KeywordResult[] {
    const queryTerms = this.tokenize(query);
    const scores: Array<{ docIndex: number; score: number; matched: string[] }> = [];

    for (let i = 0; i < this.documents.length; i++) {
      let score = 0;
      const matched: string[] = [];

      for (const term of queryTerms) {
        const tf = this.termFrequency.get(term)?.get(i) ?? 0;
        if (tf === 0) continue;

        matched.push(term);
        const df = this.documentFrequency.get(term) ?? 0;
        const idf = Math.log(
          (this.documents.length - df + 0.5) / (df + 0.5) + 1
        );
        const docLen = this.documentLengths[i];
        const numerator = tf * (this.k1 + 1);
        const denominator =
          tf + this.k1 * (1 - this.b + this.b * (docLen / this.avgDocLength));

        score += idf * (numerator / denominator);
      }

      if (score > 0) {
        scores.push({ docIndex: i, score, matched });
      }
    }

    return scores
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map((s) => ({
        chunk: this.documents[s.docIndex],
        score: s.score,
        matchedTerms: s.matched,
      }));
  }

  /**
   * Simple tokenizer: lowercase, split on non-alphanumeric, remove stopwords.
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
  }
}

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "in", "on", "at", "to",
  "for", "of", "with", "by", "is", "it", "as", "be", "was",
  "are", "been", "has", "had", "have", "do", "did", "does",
  "this", "that", "these", "those", "not", "no", "so", "if",
  "we", "he", "she", "they", "you", "me", "my", "your", "its",
  "from", "will", "can", "may", "would", "could", "should",
]);
