/**
 * SkillsLoader — discovers and loads skill metadata.
 *
 * Skills follow OpenClaw's pattern: only metadata (name, description, path)
 * is injected into the system prompt. The full SKILL.md content is loaded
 * on-demand when the agent decides to use a skill.
 *
 * This prevents context bloat while keeping skills discoverable.
 *
 * Skill directories are scanned for SKILL.md files, which contain
 * the skill's name, description, and trigger patterns as frontmatter.
 */

import type { SkillMetadata } from "@kyles-openclaw/shared";
import { readFile, readdir, stat } from "fs/promises";
import { join } from "path";

export class SkillsLoader {
  private skillsDirs: string[];
  private cachedSkills: SkillMetadata[] | null = null;

  constructor(skillsDirs: string[]) {
    this.skillsDirs = skillsDirs;
  }

  /**
   * Load skill metadata from all configured directories.
   * Results are cached — call reload() to refresh.
   */
  async loadAll(): Promise<SkillMetadata[]> {
    if (this.cachedSkills) return this.cachedSkills;

    const skills: SkillMetadata[] = [];

    for (const dir of this.skillsDirs) {
      try {
        const entries = await readdir(dir);
        for (const entry of entries) {
          const skillPath = join(dir, entry, "SKILL.md");
          try {
            const fileStat = await stat(skillPath);
            if (!fileStat.isFile()) continue;

            const content = await readFile(skillPath, "utf-8");
            const metadata = this.parseSkillMetadata(content, skillPath);
            if (metadata) skills.push(metadata);
          } catch {
            // No SKILL.md in this directory
          }
        }
      } catch {
        // Skills directory doesn't exist
      }
    }

    this.cachedSkills = skills;
    return skills;
  }

  /**
   * Read the full content of a skill file.
   */
  async readSkill(path: string): Promise<string | null> {
    try {
      return await readFile(path, "utf-8");
    } catch {
      return null;
    }
  }

  /**
   * Clear the cache to force re-discovery.
   */
  reload(): void {
    this.cachedSkills = null;
  }

  /**
   * Parse SKILL.md frontmatter for metadata.
   * Expected format:
   * ```
   * ---
   * name: My Skill
   * description: Does something useful
   * triggers:
   *   - pattern1
   *   - pattern2
   * ---
   * (rest of the skill content)
   * ```
   */
  private parseSkillMetadata(
    content: string,
    path: string
  ): SkillMetadata | null {
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) {
      // No frontmatter — use filename as name and first line as description
      const lines = content.split("\n").filter((l) => l.trim());
      return {
        name: path.split("/").slice(-2, -1)[0] ?? "unknown",
        description: lines[0]?.replace(/^#+\s*/, "") ?? "No description",
        path,
      };
    }

    const frontmatter = frontmatterMatch[1];
    const name = this.extractField(frontmatter, "name") ?? "unknown";
    const description =
      this.extractField(frontmatter, "description") ?? "No description";
    const triggersStr = this.extractField(frontmatter, "triggers");
    const triggers = triggersStr
      ? triggersStr
          .split("\n")
          .map((t) => t.replace(/^\s*-\s*/, "").trim())
          .filter(Boolean)
      : undefined;

    return { name, description, path, triggers };
  }

  private extractField(
    frontmatter: string,
    field: string
  ): string | undefined {
    const match = frontmatter.match(
      new RegExp(`^${field}:\\s*(.+)$`, "m")
    );
    return match?.[1]?.trim();
  }
}
