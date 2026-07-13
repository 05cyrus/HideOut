/**
 * WebRTC PeerLink implementation for real LAN play.
 *
 * Offline-first: NO ICE servers are configured — on a shared Wi-Fi/hotspot,
 * host candidates (and mDNS .local candidates) are sufficient, so connections
 * establish with zero internet. Signaling is non-trickle: we wait for ICE
 * gathering to complete and ship ONE self-contained description blob, which is
 * what makes QR/paste signaling practical.
 *
 * Channel setup: the host side creates both channels ('r' reliable-ordered,
 * 'u' unordered + maxRetransmits:0); the joiner receives them via ondatachannel.
 */
import type { ChannelKind, MessageHandler, PeerLink } from './PeerLink';
import { encodeSignalBlob, decodeSignalBlob } from '../signaling/blob';

/** Backpressure guard: skip unreliable sends when the channel is congested. */
const UNRELIABLE_MAX_BUFFERED = 64 * 1024;

let linkCounter = 0;

class WebRTCLink implements PeerLink {
  readonly id = `rtc-${linkCounter++}`;
  private handler: MessageHandler | null = null;
  private closeHandler: (() => void) | null = null;
  private closed = false;

  constructor(
    private readonly pc: RTCPeerConnection,
    private readonly reliable: RTCDataChannel,
    private readonly unreliable: RTCDataChannel,
  ) {
    for (const [kind, ch] of [
      ['reliable', reliable],
      ['unreliable', unreliable],
    ] as const) {
      ch.binaryType = 'arraybuffer';
      ch.onmessage = (ev: MessageEvent) => {
        if (ev.data instanceof ArrayBuffer) {
          this.handler?.(kind, new Uint8Array(ev.data));
        }
      };
      ch.onclose = () => this.teardown();
    }
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        this.teardown();
      }
    };
  }

  send(channel: ChannelKind, data: Uint8Array): void {
    if (this.closed) return;
    const ch = channel === 'reliable' ? this.reliable : this.unreliable;
    if (ch.readyState !== 'open') return;
    if (channel === 'unreliable' && ch.bufferedAmount > UNRELIABLE_MAX_BUFFERED) {
      return; // drop rather than queue stale state
    }
    // Copy into a fresh buffer so callers may reuse theirs.
    ch.send(data.slice().buffer as ArrayBuffer);
  }

  onMessage(handler: MessageHandler): void {
    this.handler = handler;
  }

  onClose(handler: () => void): void {
    this.closeHandler = handler;
  }

  close(): void {
    this.teardown();
  }

  private teardown(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.reliable.close();
      this.unreliable.close();
      this.pc.close();
    } catch {
      /* already closed */
    }
    this.closeHandler?.();
  }
}

function waitIceComplete(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const check = () => {
      if (pc.iceGatheringState === 'complete') {
        pc.removeEventListener('icegatheringstatechange', check);
        resolve();
      }
    };
    pc.addEventListener('icegatheringstatechange', check);
    // Safety valve: some stacks stall shy of 'complete'; ship what we have.
    setTimeout(() => {
      pc.removeEventListener('icegatheringstatechange', check);
      resolve();
    }, 3000);
  });
}

function channelsOpen(reliable: RTCDataChannel, unreliable: RTCDataChannel): Promise<void> {
  const one = (ch: RTCDataChannel) =>
    ch.readyState === 'open'
      ? Promise.resolve()
      : new Promise<void>((resolve, reject) => {
          ch.onopen = () => resolve();
          ch.onerror = () => reject(new Error('data channel failed'));
        });
  return Promise.all([one(reliable), one(unreliable)]).then(() => undefined);
}

export interface PendingHostPeer {
  /** Compressed offer blob — show as QR / copy-paste to the joiner. */
  offerBlob: string;
  /** Feed the joiner's answer blob back in; resolves with the open link. */
  acceptAnswer(answerBlob: string): Promise<PeerLink>;
  /** Abort this pending invite. */
  cancel(): void;
}

/** HOST side: create an invite (offer) for one prospective joiner. */
export async function createHostPeer(): Promise<PendingHostPeer> {
  const pc = new RTCPeerConnection({ iceServers: [] });
  const reliable = pc.createDataChannel('r', { ordered: true });
  const unreliable = pc.createDataChannel('u', { ordered: false, maxRetransmits: 0 });

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitIceComplete(pc);
  const local = pc.localDescription;
  if (!local) throw new Error('no local description after ICE gathering');

  return {
    offerBlob: encodeSignalBlob({ type: local.type, sdp: local.sdp }),
    async acceptAnswer(answerBlob: string): Promise<PeerLink> {
      const answer = decodeSignalBlob(answerBlob);
      await pc.setRemoteDescription({ type: answer.type as RTCSdpType, sdp: answer.sdp });
      await channelsOpen(reliable, unreliable);
      return new WebRTCLink(pc, reliable, unreliable);
    },
    cancel(): void {
      pc.close();
    },
  };
}

/** JOINER side: consume an offer blob, produce an answer blob + eventual link. */
export async function joinHostPeer(
  offerBlob: string,
): Promise<{ answerBlob: string; link: Promise<PeerLink> }> {
  const offer = decodeSignalBlob(offerBlob);
  const pc = new RTCPeerConnection({ iceServers: [] });

  const channels = new Promise<{ reliable: RTCDataChannel; unreliable: RTCDataChannel }>(
    (resolve, reject) => {
      let reliable: RTCDataChannel | null = null;
      let unreliable: RTCDataChannel | null = null;
      pc.ondatachannel = (ev) => {
        if (ev.channel.label === 'r') reliable = ev.channel;
        else if (ev.channel.label === 'u') unreliable = ev.channel;
        if (reliable && unreliable) resolve({ reliable, unreliable });
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed') reject(new Error('connection failed'));
      };
    },
  );

  await pc.setRemoteDescription({ type: offer.type as RTCSdpType, sdp: offer.sdp });
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await waitIceComplete(pc);
  const local = pc.localDescription;
  if (!local) throw new Error('no local description after ICE gathering');

  const link = channels.then(async ({ reliable, unreliable }) => {
    await channelsOpen(reliable, unreliable);
    return new WebRTCLink(pc, reliable, unreliable) as PeerLink;
  });

  return {
    answerBlob: encodeSignalBlob({ type: local.type, sdp: local.sdp }),
    link,
  };
}
