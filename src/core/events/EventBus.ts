/**
 * Typed publish/subscribe event bus.
 *
 * The `Events` type parameter maps event names to their payload types, giving fully
 * type-checked `emit`/`on` at the call site. Used to decouple systems (input → game,
 * net → game, game → UI) without hard references between them.
 *
 * Safe against mutation during dispatch: `emit` iterates a snapshot, so handlers may
 * subscribe/unsubscribe (including `once`) while an event is being delivered.
 */
export type EventHandler<T> = (payload: T) => void;
export type Unsubscribe = () => void;

interface Listener {
  handler: EventHandler<unknown>;
  once: boolean;
}

export class EventBus<Events extends Record<string, unknown>> {
  private readonly listeners = new Map<keyof Events, Set<Listener>>();

  on<K extends keyof Events>(type: K, handler: EventHandler<Events[K]>): Unsubscribe {
    return this.addListener(type, handler as EventHandler<unknown>, false);
  }

  once<K extends keyof Events>(type: K, handler: EventHandler<Events[K]>): Unsubscribe {
    return this.addListener(type, handler as EventHandler<unknown>, true);
  }

  off<K extends keyof Events>(type: K, handler: EventHandler<Events[K]>): void {
    const set = this.listeners.get(type);
    if (!set) return;
    for (const listener of set) {
      if (listener.handler === (handler as EventHandler<unknown>)) {
        set.delete(listener);
        break;
      }
    }
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    const set = this.listeners.get(type);
    if (!set || set.size === 0) return;
    // Snapshot so handlers can mutate the set safely during dispatch.
    const snapshot = Array.from(set);
    for (const listener of snapshot) {
      if (listener.once) set.delete(listener);
      (listener.handler as EventHandler<Events[K]>)(payload);
    }
  }

  clear<K extends keyof Events>(type?: K): void {
    if (type === undefined) this.listeners.clear();
    else this.listeners.delete(type);
  }

  listenerCount<K extends keyof Events>(type: K): number {
    return this.listeners.get(type)?.size ?? 0;
  }

  private addListener(
    type: keyof Events,
    handler: EventHandler<unknown>,
    once: boolean,
  ): Unsubscribe {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set<Listener>();
      this.listeners.set(type, set);
    }
    const listener: Listener = { handler, once };
    set.add(listener);
    return () => {
      set.delete(listener);
    };
  }
}
