/**
 * Client-side session: prediction for the local player, interpolation for
 * everyone else, reconciliation against host snapshots.
 *
 * Prediction loop:
 *  1. submitLocalInput → step the local player immediately (same stepPlayer +
 *     resolveSpeed as the host) and send the last N commands unreliably.
 *  2. On snapshot: adopt the authoritative record for us, drop acked inputs,
 *     replay the still-pending ones. On LAN the correction is sub-millimeter;
 *     there is deliberately no smoothing in the slice.
 *  3. Remote entities: push samples into per-entity Interpolators and render
 *     `interpDelayTicks` behind the newest server tick.
 */
import { EventBus } from '../../core/events';
import { create as vec3Create } from '../../core/math/vec3';
import { GamePhase, PropType } from '../../game/types';
import type { EntityRecord, InputCommand, Role, SimEvent } from '../../game/types';
import type { GameConfig } from '../../game/config';
import type { MapDef } from '../../game/maps/types';
import type { CollisionWorld } from '../../game/physics';
import { stepPlayer, type MovementState } from '../../game/movement';
import { resolveSpeed } from '../../game/speed';
import { ByteWriter } from '../protocol/bytes';
import {
  PacketType,
  decodeSnapshot,
  encodeInputPacket,
  packetType,
  type Snapshot,
} from '../protocol/packets';
import { decodeEvent, encodeEvent, type RosterEntry } from '../protocol/events';
import { Interpolator } from '../sync/Interpolator';
import type { ChannelKind, PeerLink } from '../transport/PeerLink';
import type { GameSession, LocalState, PhaseInfo, SessionEventMap } from './types';

const PING_INTERVAL_TICKS = 60; // ~2 s at 30 Hz
const MAX_PENDING_INPUTS = 128;

interface RemoteEntity {
  interp: Interpolator;
  latest: EntityRecord;
}

export class ClientSession implements GameSession {
  readonly isHost = false;
  readonly events = new EventBus<SessionEventMap>();

  localNetId = -1;
  mapId = '';

  private map: MapDef | null = null;
  private collision: CollisionWorld | null = null;

  private phase = GamePhase.Waiting;
  /** Server tick at which the current phase ends (-1 = indefinite). */
  private phaseEndTick = -1;
  private rosterList: RosterEntry[] = [];

  private readonly local: MovementState = { pos: vec3Create(), yaw: 0, pitch: 0 };
  private localRole: Role = 'hider';
  private localAlive = true;
  private localPropType = PropType.None;
  private localLocked = false;
  private localHealth = 255;
  private localSwapsLeft = 0;

  private pending: InputCommand[] = [];
  private readonly remotes = new Map<number, RemoteEntity>();
  private latestServerTick = 0;
  private renderTick = 0;
  private tickCounter = 0;
  private rtt = 0;
  private readonly writer = new ByteWriter(256);

  constructor(
    private readonly link: PeerLink,
    playerName: string,
    private readonly mapRegistry: Record<string, MapDef>,
    private readonly config: GameConfig,
    private readonly now: () => number = () => performance.now(),
  ) {
    this.localSwapsLeft = config.props.maxSwaps;
    link.onMessage((channel, data) => this.onMessage(channel, data));
    link.onClose(() => this.events.emit('disconnected', { reason: 'connection closed' }));
    link.send('reliable', encodeEvent({ t: 'join', name: playerName }));
  }

  // ── GameSession ───────────────────────────────────────────────────────────

  submitLocalInput(cmd: InputCommand): void {
    if (!this.collision || this.localNetId < 0) return;

    // Predict immediately with the same code the host runs.
    const speed = resolveSpeed(
      this.config,
      this.phase,
      this.localRole,
      this.localAlive,
      this.localPropType,
      this.localLocked,
    );
    stepPlayer(
      this.local,
      cmd,
      this.collision,
      this.config.player.radius,
      speed,
      1 / this.config.tickRate,
    );

    this.pending.push(cmd);
    if (this.pending.length > MAX_PENDING_INPUTS) this.pending.shift();

    // Send the redundancy window (masks unreliable loss; host dedupes by seq).
    const windowStart = Math.max(0, this.pending.length - this.config.net.inputRedundancy);
    const packet = encodeInputPacket(this.writer, this.pending.slice(windowStart));
    this.link.send('unreliable', packet);
  }

  fixedTick(): void {
    this.tickCounter++;
    if (this.tickCounter % PING_INTERVAL_TICKS === 0) {
      this.link.send('reliable', encodeEvent({ t: 'ping', t0: this.now() }));
    }
  }

  frame(dtSeconds: number): void {
    // Advance the interpolation playhead in server-tick units, gently steering
    // toward (latest − delay); snap when badly off (join, long stall).
    const target = this.latestServerTick - this.config.net.interpDelayTicks;
    this.renderTick += dtSeconds * this.config.tickRate;
    const drift = target - this.renderTick;
    if (Math.abs(drift) > this.config.tickRate) this.renderTick = target;
    else this.renderTick += drift * 0.05;
  }

  views(): EntityRecord[] {
    const result: EntityRecord[] = [];
    if (this.localNetId >= 0) result.push(this.localRecord());
    for (const [netId, remote] of this.remotes) {
      if (netId === this.localNetId) continue;
      const sampled = remote.interp.sample(this.renderTick);
      result.push(
        sampled
          ? { ...remote.latest, x: sampled.x, z: sampled.z, yaw: sampled.yaw }
          : remote.latest,
      );
    }
    return result;
  }

  localState(): LocalState | null {
    if (this.localNetId < 0) return null;
    return { record: this.localRecord(), pitch: this.local.pitch, swapsLeft: this.localSwapsLeft };
  }

  phaseInfo(): PhaseInfo {
    const secondsLeft =
      this.phaseEndTick < 0
        ? -1
        : Math.max(0, (this.phaseEndTick - this.latestServerTick) / this.config.tickRate);
    return { phase: this.phase, secondsLeft };
  }

  roster(): RosterEntry[] {
    return this.rosterList;
  }

  rttMs(): number {
    return this.rtt;
  }

  setReady(ready: boolean): void {
    this.link.send('reliable', encodeEvent({ t: 'ready', ready }));
  }

  startRound(): boolean {
    return false; // host-only action
  }

  leave(): void {
    this.link.send('reliable', encodeEvent({ t: 'leave' }));
    this.link.close();
  }

  // ── Wire handling ─────────────────────────────────────────────────────────

  private onMessage(channel: ChannelKind, data: Uint8Array): void {
    if (channel === 'unreliable') {
      if (packetType(data) === PacketType.Snapshot) {
        try {
          this.onSnapshot(decodeSnapshot(data));
        } catch {
          /* malformed snapshot: skip; next one recovers */
        }
      }
      return;
    }

    try {
      const event = decodeEvent(data);
      switch (event.t) {
        case 'welcome':
          this.localNetId = event.netId;
          this.mapId = event.mapId;
          this.map = this.mapRegistry[event.mapId] ?? null;
          this.collision = this.map
            ? { bounds: this.map.bounds, colliders: this.map.colliders }
            : null;
          this.phase = event.phase;
          this.rosterList = event.roster;
          this.events.emit('connected', { netId: event.netId });
          this.events.emit('roster', event.roster);
          break;
        case 'roster':
          this.rosterList = event.roster;
          this.events.emit('roster', event.roster);
          break;
        case 'sim':
          this.applySimEvent(event.e, event.tick);
          break;
        case 'pong':
          this.rtt = Math.max(0, this.now() - event.t0);
          break;
        case 'ping':
          this.link.send('reliable', encodeEvent({ t: 'pong', t0: event.t0 }));
          break;
        case 'leave':
          this.events.emit('disconnected', { reason: 'removed by host' });
          this.link.close();
          break;
        default:
          break;
      }
    } catch {
      /* malformed reliable message: ignore */
    }
  }

  private applySimEvent(event: SimEvent, tick: number): void {
    switch (event.type) {
      case 'phase':
        this.phase = event.phase;
        this.phaseEndTick = event.durationTicks < 0 ? -1 : tick + event.durationTicks;
        if (event.phase === GamePhase.Waiting) {
          this.localSwapsLeft = this.config.props.maxSwaps;
          this.localRole = 'hider';
          this.localAlive = true;
          this.localPropType = PropType.None;
          this.localLocked = false;
        }
        this.events.emit('phase', this.phaseInfo());
        break;
      case 'roleAssigned':
        this.localRole = event.hunterNetId === this.localNetId ? 'hunter' : 'hider';
        this.localSwapsLeft = this.config.props.maxSwaps;
        this.localPropType = PropType.None;
        this.localLocked = false;
        this.localAlive = true;
        break;
      case 'possessed':
        if (event.netId === this.localNetId) {
          this.localPropType = event.propType;
          this.localLocked = false;
          this.localSwapsLeft = event.swapsLeft;
        }
        break;
      case 'lockChanged':
        if (event.netId === this.localNetId) this.localLocked = event.locked;
        break;
      case 'eliminated':
        if (event.netId === this.localNetId) this.localAlive = false;
        break;
      default:
        break;
    }
    this.events.emit('sim', event);
  }

  private onSnapshot(snapshot: Snapshot): void {
    if (snapshot.tick <= this.latestServerTick) return; // stale (unordered channel)
    this.latestServerTick = snapshot.tick;

    for (const record of snapshot.entities) {
      if (record.netId === this.localNetId) {
        this.reconcile(record, snapshot.ackSeq);
      } else {
        let remote = this.remotes.get(record.netId);
        if (!remote) {
          remote = { interp: new Interpolator(), latest: record };
          this.remotes.set(record.netId, remote);
        }
        remote.latest = record;
        remote.interp.push({ tick: snapshot.tick, x: record.x, z: record.z, yaw: record.yaw });
      }
    }

    // Forget entities the host no longer reports (players who left).
    for (const netId of this.remotes.keys()) {
      if (!snapshot.entities.some((e) => e.netId === netId)) this.remotes.delete(netId);
    }
  }

  private reconcile(record: EntityRecord, ackSeq: number): void {
    // Authoritative status flags always win.
    this.localAlive = record.alive;
    this.localRole = record.role;
    this.localPropType = record.propType;
    this.localLocked = record.locked;
    this.localHealth = record.health;

    if (!this.collision) return;

    // Rewind to the authoritative position, drop acked inputs, replay the rest.
    this.local.pos.x = record.x;
    this.local.pos.z = record.z;
    this.pending = this.pending.filter((cmd) => cmd.seq > ackSeq);
    for (const cmd of this.pending) {
      const speed = resolveSpeed(
        this.config,
        this.phase,
        this.localRole,
        this.localAlive,
        this.localPropType,
        this.localLocked,
      );
      stepPlayer(
        this.local,
        cmd,
        this.collision,
        this.config.player.radius,
        speed,
        1 / this.config.tickRate,
      );
    }
  }

  private localRecord(): EntityRecord {
    return {
      netId: this.localNetId,
      x: this.local.pos.x,
      z: this.local.pos.z,
      yaw: this.local.yaw,
      alive: this.localAlive,
      role: this.localRole,
      propType: this.localPropType,
      locked: this.localLocked,
      health: this.localHealth,
    };
  }
}
