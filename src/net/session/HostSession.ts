/**
 * HideOut — A 3D multiplayer prop-hunt game
 * Copyright (c) 2026 Sumit Gusain
 * Licensed under the MIT License - see LICENSE file for details
 *
 * Host-side session: owns the authoritative HostSimulation and fans state out.
 *
 * Per fixed tick: queue the host's own input, step the sim, broadcast the sim
 * events (reliable) and a per-peer snapshot (unreliable, with that peer's input
 * ack for reconciliation). The host is also player netId 0 — there is no
 * separate dedicated-server mode in the slice, but nothing here prevents one.
 */
import { EventBus } from '../../core/events';
import { GamePhase, PropType } from '../../game/types';
import type { EntityRecord, InputCommand, SimEvent } from '../../game/types';
import type { GameConfig } from '../../game/config';
import type { MapDef } from '../../game/maps/types';
import { HostSimulation } from '../../game/HostSimulation';
import { ByteWriter } from '../protocol/bytes';
import { PacketType, encodeSnapshot, decodeInputPacket, packetType } from '../protocol/packets';
import { decodeEvent, encodeEvent, type NetEvent, type RosterEntry } from '../protocol/events';
import type { ChannelKind, PeerLink } from '../transport/PeerLink';
import type { GameSession, LocalState, PhaseInfo, SessionEventMap } from './types';

export interface HostSessionOptions {
  roomName: string;
  hostName: string;
  map: MapDef;
  config: GameConfig;
  /** Seed for hunter selection; defaults to a time-derived value. */
  seed?: number;
}

function sanitizeName(name: string): string {
  const trimmed = name.trim().slice(0, 16);
  return trimmed.length > 0 ? trimmed : 'Player';
}

export class HostSession implements GameSession {
  readonly isHost = true;
  readonly localNetId = 0;
  readonly events = new EventBus<SessionEventMap>();
  readonly mapId: string;

  private readonly sim: HostSimulation;
  private readonly peers = new Map<number, PeerLink>();
  private nextNetId = 1;
  private readonly writer = new ByteWriter(2048);
  private readonly roomName: string;
  private localPitch = 0;
  private localSwapsLeft = 0;

  constructor(private readonly options: HostSessionOptions) {
    this.mapId = options.map.id;
    this.roomName = options.roomName;
    this.sim = new HostSimulation(
      options.map,
      options.config,
      options.seed ?? Date.now() & 0x7fffffff,
    );
    this.sim.addPlayer(this.localNetId, sanitizeName(options.hostName));
    this.sim.setReady(this.localNetId, true); // the host is implicitly ready
    this.localSwapsLeft = options.config.props.maxSwaps;
  }

  /** Wire up a freshly-opened link; the peer becomes a player on 'join'. */
  attachPeer(link: PeerLink): void {
    let netId = -1;

    link.onMessage((channel: ChannelKind, data: Uint8Array) => {
      if (netId === -1) {
        // Only a reliable 'join' promotes the link to a player.
        if (channel !== 'reliable') return;
        let event: NetEvent;
        try {
          event = decodeEvent(data);
        } catch {
          return;
        }
        if (event.t !== 'join') return;

        if (this.sim.phase !== GamePhase.Waiting) {
          link.send('reliable', encodeEvent({ t: 'leave' }));
          link.close();
          return;
        }

        netId = this.nextNetId++;
        this.peers.set(netId, link);
        this.sim.addPlayer(netId, sanitizeName(event.name));
        link.send(
          'reliable',
          encodeEvent({
            t: 'welcome',
            netId,
            mapId: this.mapId,
            roomName: this.roomName,
            phase: this.sim.phase,
            roster: this.sim.rosterNames(),
          }),
        );
        this.broadcastRoster();
        return;
      }
      this.onPeerMessage(netId, channel, data);
    });

    link.onClose(() => {
      if (netId !== -1) this.dropPeer(netId);
    });
  }

  // ── GameSession ───────────────────────────────────────────────────────────

  submitLocalInput(cmd: InputCommand): void {
    this.localPitch = cmd.pitch;
    this.sim.queueInput(this.localNetId, [cmd]);
  }

  fixedTick(): void {
    const simEvents = this.sim.step();

    for (const event of simEvents) {
      this.applyLocalBookkeeping(event);
      this.events.emit('sim', event);
      if (event.type === 'phase') this.events.emit('phase', this.phaseInfo());
      this.broadcast({ t: 'sim', e: event, tick: this.sim.tick });
    }

    // Snapshot per peer: same entities, per-peer input ack.
    const entities = this.sim.records();
    for (const [netId, link] of this.peers) {
      const packet = encodeSnapshot(this.writer, {
        tick: this.sim.tick,
        ackSeq: this.sim.lastProcessedSeq(netId),
        entities,
      });
      link.send('unreliable', packet);
    }
  }

  frame(_dtSeconds: number): void {
    // Host renders authoritative state directly; nothing to advance.
  }

  views(): EntityRecord[] {
    return this.sim.records();
  }

  localState(): LocalState | null {
    const record = this.sim.records().find((r) => r.netId === this.localNetId);
    if (!record) return null;
    return { record, pitch: this.localPitch, swapsLeft: this.localSwapsLeft };
  }

  phaseInfo(): PhaseInfo {
    return { phase: this.sim.phase, secondsLeft: this.sim.secondsLeftInPhase() };
  }

  roster(): RosterEntry[] {
    return this.sim.rosterNames();
  }

  rttMs(): number {
    return 0; // the host IS the authority
  }

  setReady(ready: boolean): void {
    this.sim.setReady(this.localNetId, ready);
    this.broadcastRoster();
  }

  startRound(): boolean {
    const started = this.sim.startRound();
    if (started) this.localSwapsLeft = this.options.config.props.maxSwaps;
    return started;
  }

  leave(): void {
    this.broadcast({ t: 'leave' });
    for (const link of this.peers.values()) link.close();
    this.peers.clear();
  }

  get playerCount(): number {
    return this.sim.playerCount;
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private onPeerMessage(netId: number, channel: ChannelKind, data: Uint8Array): void {
    if (channel === 'unreliable') {
      if (packetType(data) === PacketType.Input) {
        try {
          this.sim.queueInput(netId, decodeInputPacket(data));
        } catch {
          /* malformed packet from a peer: ignore, authority is unaffected */
        }
      }
      return;
    }

    let event: NetEvent;
    try {
      event = decodeEvent(data);
    } catch {
      return;
    }
    switch (event.t) {
      case 'ready':
        this.sim.setReady(netId, event.ready);
        this.broadcastRoster();
        break;
      case 'ping':
        this.peers.get(netId)?.send('reliable', encodeEvent({ t: 'pong', t0: event.t0 }));
        break;
      case 'leave':
        this.dropPeer(netId);
        break;
      default:
        break; // clients cannot inject sim/roster/welcome events
    }
  }

  private dropPeer(netId: number): void {
    const link = this.peers.get(netId);
    if (!link) return;
    this.peers.delete(netId);
    link.close();
    this.sim.removePlayer(netId);
    this.broadcastRoster();
  }

  private applyLocalBookkeeping(event: SimEvent): void {
    if (event.type === 'possessed' && event.netId === this.localNetId) {
      this.localSwapsLeft = event.swapsLeft;
    }
    if (event.type === 'roleAssigned') {
      this.localSwapsLeft = this.options.config.props.maxSwaps;
    }
    if (event.type === 'phase' && event.phase === GamePhase.Waiting) {
      this.localSwapsLeft = this.options.config.props.maxSwaps;
    }
  }

  private broadcast(event: NetEvent): void {
    const encoded = encodeEvent(event);
    for (const link of this.peers.values()) link.send('reliable', encoded);
  }

  private broadcastRoster(): void {
    const roster = this.sim.rosterNames();
    this.events.emit('roster', roster);
    this.broadcast({ t: 'roster', roster });
  }
}

/** Convenience for HUD copy: does the local (host) hider have a disguise? */
export function isDisguised(record: EntityRecord): boolean {
  return record.propType !== PropType.None;
}
