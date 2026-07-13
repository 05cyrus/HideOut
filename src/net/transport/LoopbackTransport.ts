/**
 * In-process PeerLink pair for tests, bots, and the latency/loss harness.
 *
 * Delivery is explicit: nothing arrives until `pump()` is called, which makes
 * integration tests fully deterministic. Optional latency holds messages until
 * enough fake time has passed; optional loss drops unreliable messages via a
 * seeded PRNG (reliable messages are never dropped, matching real transports).
 */
import { mulberry32 } from '../../core/math/random';
import type { ChannelKind, MessageHandler, PeerLink } from './PeerLink';

export interface LoopbackOptions {
  /** One-way latency in ms of fake time. Default 0. */
  latencyMs?: number;
  /** Probability [0,1] that an unreliable message is dropped. Default 0. */
  unreliableLoss?: number;
  /** PRNG seed for loss decisions. */
  seed?: number;
}

interface QueuedMessage {
  channel: ChannelKind;
  data: Uint8Array;
  deliverAt: number;
}

export interface LoopbackPair {
  a: PeerLink;
  b: PeerLink;
  /** Advance fake time and deliver everything due. */
  pump(advanceMs?: number): void;
  /** Deliver everything regardless of latency (drains both directions). */
  flush(): void;
}

class LoopbackLink implements PeerLink {
  handler: MessageHandler | null = null;
  closeHandler: (() => void) | null = null;
  closed = false;
  peer!: LoopbackLink;

  constructor(
    readonly id: string,
    private readonly outbox: QueuedMessage[],
    private readonly opts: Required<LoopbackOptions>,
    private readonly now: () => number,
    private readonly rng: () => number,
  ) {}

  send(channel: ChannelKind, data: Uint8Array): void {
    if (this.closed) return;
    if (channel === 'unreliable' && this.opts.unreliableLoss > 0) {
      if (this.rng() < this.opts.unreliableLoss) return; // dropped "on the wire"
    }
    // Copy: real transports serialize; senders must be free to reuse buffers.
    this.outbox.push({
      channel,
      data: data.slice(),
      deliverAt: this.now() + this.opts.latencyMs,
    });
  }

  onMessage(handler: MessageHandler): void {
    this.handler = handler;
  }

  onClose(handler: () => void): void {
    this.closeHandler = handler;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.peer.closed = true;
    this.peer.closeHandler?.();
    this.closeHandler?.();
  }
}

let pairCounter = 0;

export function createLoopbackPair(options: LoopbackOptions = {}): LoopbackPair {
  const opts: Required<LoopbackOptions> = {
    latencyMs: options.latencyMs ?? 0,
    unreliableLoss: options.unreliableLoss ?? 0,
    seed: options.seed ?? 1,
  };
  let fakeTime = 0;
  const now = () => fakeTime;
  const rng = mulberry32(opts.seed);
  const id = pairCounter++;

  const aToB: QueuedMessage[] = [];
  const bToA: QueuedMessage[] = [];
  const a = new LoopbackLink(`loop${id}-a`, aToB, opts, now, rng);
  const b = new LoopbackLink(`loop${id}-b`, bToA, opts, now, rng);
  a.peer = b;
  b.peer = a;

  function deliverDue(queue: QueuedMessage[], target: LoopbackLink, all: boolean): void {
    // Preserve order; deliver messages whose time has come (or everything on flush).
    while (queue.length > 0) {
      const msg = queue[0]!;
      if (!all && msg.deliverAt > fakeTime) break; // later messages are later still
      queue.shift();
      if (!target.closed) target.handler?.(msg.channel, msg.data);
    }
  }

  return {
    a,
    b,
    pump(advanceMs = 0): void {
      fakeTime += advanceMs;
      deliverDue(aToB, b, false);
      deliverDue(bToA, a, false);
    },
    flush(): void {
      deliverDue(aToB, b, true);
      deliverDue(bToA, a, true);
    },
  };
}
