/**
 * MemoryFileManager — manages the Markdown-based memory files.
 *
 * Memory is stored as Markdown files on disk — the source of truth.
 * Daily files (YYYY-MM-DD.md) are created by the proactive flush.
 * A curated MEMORY.md file holds long-term knowledge.
 *
 * File-first approach means:
 * - Human readable and editable
 * - Survives database corruption
 * - Git-trackable
 * - No vendor lock-in
 */

import { readFile, writeFile, readdir, mkdir, stat } from "fs/promises";
import { join, extname } from "path";

export class MemoryFileManager {
  private memoryDir: string;

  constructor(memoryDir: string) {
    this.memoryDir = memoryDir;
  }

  /**
   * Ensure the memory directory exists.
   */
  async init(): Promise<void> {
    await mkdir(this.memoryDir, { recursive: true });
  }

  /**
   * Read all memory files and return their contents.
   */
  async readAll(): Promise<Array<{ path: string; content: string }>> {
    await this.init();
    const files: Array<{ path: string; content: string }> = [];

    try {
      const entries = await readdir(this.memoryDir);

      for (const entry of entries) {
        if (extname(entry) !== ".md") continue;
        const fullPath = join(this.memoryDir, entry);
        const fileStat = await stat(fullPath);
        if (!fileStat.isFile()) continue;

        const content = await readFile(fullPath, "utf-8");
        if (content.trim().length > 0) {
          files.push({ path: fullPath, content });
        }
      }
    } catch {
      // Directory might not exist yet
    }

    return files;
  }

  /**
   * Append content to a memory file (creates if doesn't exist).
   */
  async append(filename: string, content: string): Promise<string> {
    await this.init();
    const fullPath = join(this.memoryDir, filename);

    let existing = "";
    try {
      existing = await readFile(fullPath, "utf-8");
    } catch {
      // File doesn't exist yet
    }

    await writeFile(fullPath, existing + content, "utf-8");
    return fullPath;
  }

  /**
   * Write content to a memory file (overwrites).
   */
  async write(filename: string, content: string): Promise<string> {
    await this.init();
    const fullPath = join(this.memoryDir, filename);
    await writeFile(fullPath, content, "utf-8");
    return fullPath;
  }

  /**
   * Read a specific memory file.
   */
  async read(filename: string): Promise<string | null> {
    try {
      const fullPath = join(this.memoryDir, filename);
      return await readFile(fullPath, "utf-8");
    } catch {
      return null;
    }
  }

  /**
   * Get today's memory file path.
   */
  getTodayFilename(): string {
    return `${new Date().toISOString().split("T")[0]}.md`;
  }

  /**
   * Get the curated long-term memory file path.
   */
  getMemoryFilename(): string {
    return "MEMORY.md";
  }
}
