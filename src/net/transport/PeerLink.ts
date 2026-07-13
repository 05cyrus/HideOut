/**
 * Transport abstraction. A PeerLink is ONE open bidirectional connection with
 * two logical channels:
 *  - 'reliable'   → ordered, retransmitted (lobby, events, RPC)
 *  - 'unreliable' → unordered, best-effort (inputs, snapshots)
 *
 * Contract: a PeerLink is handed to session code only once it is OPEN. The
 * WebRTC implementation resolves after both data channels open; the loopback
 * pair is born open. Sessions never see connection setup.
 */
export type ChannelKind = 'reliable' | 'unreliable';

export type MessageHandler = (channel: ChannelKind, data: Uint8Array) => void;

export interface PeerLink {
  /** Stable identifier for logging/debugging (not a netId). */
  readonly id: string;
  send(channel: ChannelKind, data: Uint8Array): void;
  onMessage(handler: MessageHandler): void;
  onClose(handler: () => void): void;
  close(): void;
}
