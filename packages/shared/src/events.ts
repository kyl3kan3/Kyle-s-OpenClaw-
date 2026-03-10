/**
 * Event system for Kyle's OpenClaw.
 * Type-safe event bus for decoupled communication between components.
 */

export type EventType =
  | "message:inbound"
  | "message:outbound"
  | "session:created"
  | "session:ended"
  | "context:compaction_started"
  | "context:compaction_completed"
  | "context:flush_triggered"
  | "context:flush_completed"
  | "context:threshold_warning"
  | "memory:search"
  | "memory:written"
  | "tool:called"
  | "tool:result"
  | "agent:turn_started"
  | "agent:turn_completed"
  | "agent:error"
  | "subagent:spawned"
  | "subagent:ended";

export interface Event<T = unknown> {
  type: EventType;
  timestamp: number;
  payload: T;
}

export type EventHandler<T = unknown> = (event: Event<T>) => void | Promise<void>;

export interface EventBus {
  on<T = unknown>(type: EventType, handler: EventHandler<T>): () => void;
  emit<T = unknown>(type: EventType, payload: T): Promise<void>;
  off(type: EventType, handler: EventHandler): void;
}

export class SimpleEventBus implements EventBus {
  private handlers = new Map<EventType, Set<EventHandler>>();

  on<T = unknown>(type: EventType, handler: EventHandler<T>): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    const typedHandler = handler as EventHandler;
    this.handlers.get(type)!.add(typedHandler);
    return () => this.off(type, typedHandler);
  }

  async emit<T = unknown>(type: EventType, payload: T): Promise<void> {
    const event: Event<T> = { type, timestamp: Date.now(), payload };
    const handlers = this.handlers.get(type);
    if (!handlers) return;
    const promises = [...handlers].map((h) => h(event as Event));
    await Promise.allSettled(promises);
  }

  off(type: EventType, handler: EventHandler): void {
    this.handlers.get(type)?.delete(handler);
  }
}
