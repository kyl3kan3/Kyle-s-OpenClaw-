/**
 * Skills package — bundled skills that ship with Kyle's OpenClaw.
 *
 * Each skill is a directory with a SKILL.md file containing
 * frontmatter metadata and the full skill instructions.
 *
 * Skills are loaded as metadata-only into the system prompt.
 * The agent reads the full SKILL.md on demand when it wants
 * to use a skill — preventing context bloat.
 */

export { createBundledSkillsDir } from "./bundled.js";
