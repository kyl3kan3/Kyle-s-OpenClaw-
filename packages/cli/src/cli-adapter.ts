/**
 * CLIAdapter — interactive terminal channel for Kyle's OpenClaw.
 *
 * Provides a readline-based interface for chatting with the agent
 * directly from the terminal. Supports:
 * - /stats: Show context engine statistics
 * - /memory: Search memory
 * - /clear: Start a new session
 * - /quit: Exit
 */

import { createInterface, type Interface } from "readline";
import type { ChannelAdapter } from "@kyles-openclaw/gateway";
import type { InboundMessage, OutboundMessage } from "@kyles-openclaw/shared";

export class CLIAdapter implements ChannelAdapter {
  readonly type = "cli";
  readonly channelId = "cli-local";

  private rl: Interface | null = null;
  private onMessage: ((message: InboundMessage) => Promise<void>) | null = null;

  async start(
    onMessage: (message: InboundMessage) => Promise<void>
  ): Promise<void> {
    this.onMessage = onMessage;

    this.rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: "\n🦞 > ",
    });

    console.log("╔══════════════════════════════════════════════╗");
    console.log("║     Kyle's OpenClaw — AI Agent Runtime       ║");
    console.log("║     Lossless Context Management Built-In     ║");
    console.log("╠══════════════════════════════════════════════╣");
    console.log("║  Commands:                                   ║");
    console.log("║    /stats  — Context engine statistics       ║");
    console.log("║    /memory — Search memory                   ║");
    console.log("║    /clear  — New session                     ║");
    console.log("║    /quit   — Exit                            ║");
    console.log("╚══════════════════════════════════════════════╝");
    console.log();

    this.rl.prompt();

    this.rl.on("line", async (line: string) => {
      const input = line.trim();
      if (!input) {
        this.rl?.prompt();
        return;
      }

      if (input === "/quit" || input === "/exit") {
        console.log("Goodbye! 🦞");
        process.exit(0);
      }

      if (this.onMessage) {
        const message: InboundMessage = {
          channelId: this.channelId,
          channelType: "cli",
          senderId: "local-user",
          content: input,
          timestamp: Date.now(),
        };

        await this.onMessage(message);
      }

      this.rl?.prompt();
    });

    this.rl.on("close", () => {
      console.log("\nGoodbye! 🦞");
      process.exit(0);
    });
  }

  async send(message: OutboundMessage): Promise<void> {
    console.log(`\n${message.content}`);
  }

  async stop(): Promise<void> {
    this.rl?.close();
  }
}
