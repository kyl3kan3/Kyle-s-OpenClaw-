/**
 * Gateway — the central control plane for Kyle's OpenClaw.
 *
 * The Gateway is a hub-and-spoke message router that:
 * 1. Accepts messages from channel adapters (CLI, WebSocket, etc.)
 * 2. Routes them to the correct agent runtime
 * 3. Dispatches responses back to the originating channel
 *
 * It runs as a single Node.js process — no separate services needed.
 */

import type { InboundMessage, OutboundMessage } from "@kyles-openclaw/shared";
import { SimpleEventBus } from "@kyles-openclaw/shared";
import type { AgentRuntime } from "@kyles-openclaw/agent-runtime";
import type { ChannelAdapter } from "./adapter.js";
import { ChannelRouter } from "./router.js";

export class Gateway {
  private adapters = new Map<string, ChannelAdapter>();
  private agents = new Map<string, AgentRuntime>();
  private router: ChannelRouter;
  private eventBus: SimpleEventBus;

  constructor(defaultAgentId: string) {
    this.router = new ChannelRouter(defaultAgentId);
    this.eventBus = new SimpleEventBus();
  }

  /**
   * Register a channel adapter (CLI, WebSocket, Slack, etc.).
   */
  addAdapter(adapter: ChannelAdapter): void {
    this.adapters.set(adapter.channelId, adapter);
  }

  /**
   * Register an agent runtime.
   */
  addAgent(agentId: string, runtime: AgentRuntime): void {
    this.agents.set(agentId, runtime);
  }

  /**
   * Start the gateway — begins listening on all adapters.
   */
  async start(): Promise<void> {
    // Initialize all agents
    for (const [, agent] of this.agents) {
      await agent.init();
    }

    // Start all adapters
    for (const [, adapter] of this.adapters) {
      await adapter.start(async (message: InboundMessage) => {
        await this.handleInbound(message);
      });
    }

    await this.eventBus.emit("gateway:started", {
      adapters: [...this.adapters.keys()],
      agents: [...this.agents.keys()],
    });
  }

  /**
   * Stop the gateway and all adapters.
   */
  async stop(): Promise<void> {
    for (const [, adapter] of this.adapters) {
      await adapter.stop();
    }
    await this.eventBus.emit("gateway:stopped", {});
  }

  /**
   * Handle an inbound message: route to agent, process, send response.
   */
  private async handleInbound(message: InboundMessage): Promise<void> {
    await this.eventBus.emit("message:inbound", message);

    const agentId = this.router.resolve(message);
    const agent = this.agents.get(agentId);

    if (!agent) {
      console.error(`No agent found for ID: ${agentId}`);
      return;
    }

    try {
      await agent.processMessage(message);
    } catch (error) {
      console.error("Error processing message:", error);
      await this.eventBus.emit("agent:error", {
        agentId,
        error,
        message,
      });
    }
  }

  /**
   * Send an outbound message to a specific channel.
   */
  async sendToChannel(message: OutboundMessage): Promise<void> {
    const adapter = this.adapters.get(message.channelId);
    if (!adapter) {
      console.error(`No adapter found for channel: ${message.channelId}`);
      return;
    }

    await adapter.send(message);
    await this.eventBus.emit("message:outbound", message);
  }

  /**
   * Get the router for configuring multi-agent routing.
   */
  getRouter(): ChannelRouter {
    return this.router;
  }

  /**
   * Get the event bus.
   */
  getEventBus(): SimpleEventBus {
    return this.eventBus;
  }
}
