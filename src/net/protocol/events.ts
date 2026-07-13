/**
 * Reliable-channel messages (msgpack-encoded tagged union): lobby lifecycle,
 * simulation events, and ping/pong. Low rate, so encoding convenience beats
 * hand-packing here.
 */
import { encode as msgpackEncode, decode as msgpackDecode } from '@msgpack/msgpack';
import type { GamePhase, SimEvent } from '../../game/types';

export interface RosterEntry {
  netId: number;
  name: string;
  ready: boolean;
}

export type NetEvent =
  /** client → host, first message after the link opens */
  | { t: 'join'; name: string }
  /** host → new client */
  | {
      t: 'welcome';
      netId: number;
      mapId: string;
      roomName: string;
      phase: GamePhase;
      roster: RosterEntry[];
    }
  /** host → all, on any roster change */
  | { t: 'roster'; roster: RosterEntry[] }
  /** client → host */
  | { t: 'ready'; ready: boolean }
  /** host → all, one per simulation event */
  | { t: 'sim'; e: SimEvent; tick: number }
  /** either direction; the receiver echoes `pong` with the same t0 */
  | { t: 'ping'; t0: number }
  | { t: 'pong'; t0: number }
  /** graceful leave */
  | { t: 'leave' };

export function encodeEvent(event: NetEvent): Uint8Array {
  return msgpackEncode(event);
}

export function decodeEvent(data: Uint8Array): NetEvent {
  return msgpackDecode(data) as NetEvent;
}
