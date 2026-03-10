/**
 * SessionManager — manages agent sessions with JSONL persistence.
 *
 * Each session is stored as a JSONL file containing the full transcript
 * plus compaction metadata. Sessions are identified by a stable ID
 * chosen at creation time.
 */

import type { Session, Message, CompactionState } from "@kyles-openclaw/shared";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";

export class SessionManager {
  private sessions = new Map<string, Session>();
  private sessionsDir: string;

  constructor(sessionsDir: string) {
    this.sessionsDir = sessionsDir;
  }

  async init(): Promise<void> {
    await mkdir(this.sessionsDir, { recursive: true });
  }

  /**
   * Create a new session.
   */
  async create(agentId: string, channelId: string): Promise<Session> {
    const session: Session = {
      id: `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      agentId,
      channelId,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      transcript: [],
    };

    this.sessions.set(session.id, session);
    await this.persist(session);
    return session;
  }

  /**
   * Get an existing session or create a new one.
   */
  async getOrCreate(agentId: string, channelId: string): Promise<Session> {
    // Look for an active session for this channel
    for (const session of this.sessions.values()) {
      if (
        session.agentId === agentId &&
        session.channelId === channelId
      ) {
        return session;
      }
    }

    return this.create(agentId, channelId);
  }

  /**
   * Add a message to a session's transcript.
   */
  async addMessage(sessionId: string, message: Message): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    session.transcript.push(message);
    session.lastActiveAt = Date.now();

    // Append to JSONL
    await this.appendToJSONL(sessionId, {
      type: "message",
      data: message,
    });
  }

  /**
   * Update compaction state.
   */
  async updateCompaction(
    sessionId: string,
    state: CompactionState
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    session.compaction = state;

    await this.appendToJSONL(sessionId, {
      type: "compaction",
      data: state,
    });
  }

  get(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Load a session from its JSONL file.
   */
  async load(sessionId: string): Promise<Session | null> {
    try {
      const path = join(this.sessionsDir, `${sessionId}.jsonl`);
      const content = await readFile(path, "utf-8");
      const lines = content.trim().split("\n");

      let session: Session | null = null;

      for (const line of lines) {
        const entry = JSON.parse(line);

        if (entry.type === "session") {
          session = entry.data;
          session!.transcript = [];
        } else if (entry.type === "message" && session) {
          session.transcript.push(entry.data);
        } else if (entry.type === "compaction" && session) {
          session.compaction = entry.data;
        }
      }

      if (session) {
        this.sessions.set(session.id, session);
      }

      return session;
    } catch {
      return null;
    }
  }

  private async persist(session: Session): Promise<void> {
    const path = join(this.sessionsDir, `${session.id}.jsonl`);
    const header = JSON.stringify({
      type: "session",
      data: { ...session, transcript: [] },
    });
    await writeFile(path, header + "\n", "utf-8");
  }

  private async appendToJSONL(
    sessionId: string,
    entry: { type: string; data: unknown }
  ): Promise<void> {
    const path = join(this.sessionsDir, `${sessionId}.jsonl`);
    const line = JSON.stringify(entry) + "\n";

    // Append to file
    const { appendFile } = await import("fs/promises");
    await appendFile(path, line, "utf-8");
  }
}
