/**
 * ChannelRouter — routes inbound messages to the correct agent.
 *
 * Supports multi-agent routing: different channels/accounts/peers
 * can be routed to isolated agents with separate workspaces and sessions.
 */

import type { Channel, InboundMessage } from "@kyles-openclaw/shared";

export class ChannelRouter {
  private routes = new Map<string, Channel>();
  private defaultAgentId: string;

  constructor(defaultAgentId: string) {
    this.defaultAgentId = defaultAgentId;
  }

  /**
   * Add a routing rule: messages from this channel go to this agent.
   */
  addRoute(channel: Channel): void {
    this.routes.set(channel.id, channel);
  }

  /**
   * Resolve which agent should handle this message.
   */
  resolve(message: InboundMessage): string {
    const channel = this.routes.get(message.channelId);
    return channel?.agentId ?? this.defaultAgentId;
  }

  /**
   * Get all routes.
   */
  getRoutes(): Channel[] {
    return [...this.routes.values()];
  }

  /**
   * Remove a route.
   */
  removeRoute(channelId: string): void {
    this.routes.delete(channelId);
  }
}
