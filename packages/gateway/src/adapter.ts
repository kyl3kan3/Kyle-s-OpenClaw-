/**
 * ChannelAdapter — interface for connecting messaging platforms.
 *
 * Each platform (CLI, WebSocket, Slack, Discord, etc.) implements
 * this interface to bridge messages between the platform and the gateway.
 */

import type { InboundMessage, OutboundMessage } from "@kyles-openclaw/shared";

export interface ChannelAdapter {
  readonly type: string;
  readonly channelId: string;

  /**
   * Start listening for inbound messages.
   */
  start(onMessage: (message: InboundMessage) => Promise<void>): Promise<void>;

  /**
   * Send an outbound message to the platform.
   */
  send(message: OutboundMessage): Promise<void>;

  /**
   * Stop the adapter and clean up resources.
   */
  stop(): Promise<void>;
}
