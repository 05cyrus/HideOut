/**
 * The session contract the app layer programs against. Host and client differ
 * completely in internals (authority vs prediction), but the UI, input facade,
 * and renderer see one interface — which is also what makes a future online
 * session type a drop-in.
 */
import type { EventBus } from '../../core/events';
import type { EntityRecord, GamePhase, InputCommand, SimEvent } from '../../game/types';
import type { RosterEntry } from '../protocol/events';

export interface PhaseInfo {
  phase: GamePhase;
  /** Seconds remaining in a timed phase; -1 while indefinite (Waiting). */
  secondsLeft: number;
}

/** Local-player state the HUD and camera need beyond the shared record. */
export interface LocalState {
  record: EntityRecord;
  pitch: number;
  swapsLeft: number;
}

export type SessionEventMap = {
  /** Roster changed (join/leave/ready). */
  roster: RosterEntry[];
  /** Phase transition (poll phaseInfo() for the live countdown). */
  phase: PhaseInfo;
  /** Every simulation event, for kill feed / audio / FX. */
  sim: SimEvent;
  /** Connection established (client: welcome received). */
  connected: { netId: number };
  /** Link lost or join rejected. */
  disconnected: { reason: string };
};

export interface GameSession {
  readonly isHost: boolean;
  readonly localNetId: number;
  readonly events: EventBus<SessionEventMap>;
  readonly mapId: string;

  /** Feed one local input command per fixed tick (predicts and/or simulates). */
  submitLocalInput(cmd: InputCommand): void;
  /** Advance fixed-rate work: host = sim step + broadcast; client = ping cadence. */
  fixedTick(): void;
  /** Per-render-frame work (interpolation playhead). */
  frame(dtSeconds: number): void;

  /** Render views for every player (local player uses predicted/authoritative state). */
  views(): EntityRecord[];
  localState(): LocalState | null;
  phaseInfo(): PhaseInfo;
  roster(): RosterEntry[];
  rttMs(): number;

  setReady(ready: boolean): void;
  /** Host only; returns false when preconditions fail. */
  startRound(): boolean;
  leave(): void;
}
