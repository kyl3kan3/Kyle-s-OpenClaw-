/**
 * MemoryIndexManager — the central orchestrator for all memory operations.
 *
 * Coordinates file reading, chunking, indexing, and search.
 * Watches for file changes and re-indexes automatically.
 *
 * This is the class that makes memory_search work — when the agent
 * calls memory_search("how did we fix the auth bug"), this manager
 * reads all memory files, chunks them, runs hybrid search, and
 * returns the most relevant snippets.
 */

import type { MemoryConfig, MemorySearchResult } from "@kyles-openclaw/shared";
import { Chunker, type Chunk } from "./chunker.js";
import { HybridSearch } from "./hybrid-search.js";
import { MemoryFileManager } from "./file-manager.js";
import type { EmbedFn } from "./vector-search.js";

export class MemoryIndexManager {
  private chunker: Chunker;
  private hybridSearch: HybridSearch;
  private fileManager: MemoryFileManager;
  private config: MemoryConfig;
  private indexed = false;
  private lastIndexedAt = 0;

  constructor(config: MemoryConfig, embedFn: EmbedFn) {
    this.config = config;
    this.chunker = new Chunker(config.chunkSize, config.chunkOverlap);
    this.hybridSearch = new HybridSearch(embedFn, config);
    this.fileManager = new MemoryFileManager(config.memoryDir);
  }

  /**
   * Initialize the memory system — read and index all files.
   */
  async init(): Promise<void> {
    await this.fileManager.init();
    await this.reindex();
  }

  /**
   * Re-index all memory files. Call after writes or periodically.
   */
  async reindex(): Promise<void> {
    const files = await this.fileManager.readAll();
    const allChunks: Chunk[] = [];

    for (const file of files) {
      const chunks = this.chunker.chunk(file.content, file.path);
      allChunks.push(...chunks);
    }

    await this.hybridSearch.index(allChunks);
    this.indexed = true;
    this.lastIndexedAt = Date.now();
  }

  /**
   * Search memory using hybrid (BM25 + vector) search.
   */
  async search(query: string): Promise<MemorySearchResult[]> {
    // Auto-reindex if stale (older than 60 seconds)
    if (!this.indexed || Date.now() - this.lastIndexedAt > 60000) {
      await this.reindex();
    }

    return this.hybridSearch.search(query);
  }

  /**
   * Write content to a memory file and trigger re-indexing.
   */
  async writeMemory(content: string, filename: string): Promise<string> {
    const path = await this.fileManager.append(filename, content);

    // Clear cache for this file and re-index
    this.hybridSearch.clearCache(path);
    this.indexed = false; // Mark for re-index on next search

    return path;
  }

  /**
   * Get the file manager for direct file operations.
   */
  getFileManager(): MemoryFileManager {
    return this.fileManager;
  }
}
