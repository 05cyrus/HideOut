/**
 * The authoritative game simulation. Runs ONLY on the host.
 *
 * Owns the ECS world, the round state machine, and every gameplay rule. It is pure
 * TypeScript with no knowledge of transport: inputs come in via `queueInput`, one
 * fixed tick advances via `step()` which returns the `SimEvent`s that occurred, and
 * `records()` exports authoritative entity state for snapshots. The host session
 * layer (net/) wires those to the wire.
 *
 * Anti-cheat posture: clients only ever submit *intent* (InputCommand). Movement
 * magnitude is clamped, actions are edge-detected and phase/cooldown-validated here,
 * attack targets are resolved by authoritative raycast (never client-claimed), and
 * line-of-sight is checked against walls. A client cannot eliminate, possess, or
 * move faster than config allows, no matter what packets it sends.
 */
import { World, type Entity } from '../core/ecs';
import { mulberry32 } from '../core/math/random';
import { clamp01 } from '../core/math/scalar';
import { set as vec3Set } from '../core/math/vec3';
import { Buttons, GamePhase, PropType } from './types';
import type { EntityRecord, InputCommand, SimEvent } from './types';
import type { GameConfig } from './config';
import type { CollisionWorld } from './physics';
import { raycastWalls } from './physics';
import { stepPlayer } from './movement';
import { PROP_RADIUS, type MapDef } from './maps/types';
import { resolveSpeed } from './speed';
import { Transform, Player, Disguise, Hunter, InputQueue } from './components';

export class HostSimulation {
  readonly world = new World();
  private readonly byNetId = new Map<number, Entity>();
  private readonly collision: CollisionWorld;
  private readonly rng: () => number;

  private _phase = GamePhase.Waiting;
  /** Ticks left in a timed phase; -1 for indefinite (Waiting). */
  private phaseTicksLeft = -1;
  private _tick = 0;
  private pendingEvents: SimEvent[] = [];
  private nextSpawnIndex = 0;

  constructor(
    readonly map: MapDef,
    readonly config: GameConfig,
    rngSeed = 1,
  ) {
    this.collision = { bounds: map.bounds, colliders: map.colliders };
    this.rng = mulberry32(rngSeed);
  }

  get phase(): GamePhase {
    return this._phase;
  }

  get tick(): number {
    return this._tick;
  }

  get playerCount(): number {
    return this.byNetId.size;
  }

  secondsLeftInPhase(): number {
    return this.phaseTicksLeft < 0 ? -1 : this.phaseTicksLeft / this.config.tickRate;
  }

  // ── Roster ────────────────────────────────────────────────────────────────

  addPlayer(netId: number, name: string): void {
    if (this.byNetId.has(netId)) throw new Error(`netId ${netId} already in game`);
    const entity = this.world.createEntity();
    const spawn =
      this.map.hiderSpawns[this.nextSpawnIndex++ % this.map.hiderSpawns.length] ??
      this.map.hunterSpawn;
    const t = this.world.add(entity, Transform);
    vec3Set(t.pos, spawn.x, 0, spawn.z);
    t.yaw = spawn.yaw;
    this.world.add(entity, Player, { netId, name });
    this.world.add(entity, Disguise);
    this.world.add(entity, InputQueue);
    this.byNetId.set(netId, entity);
  }

  removePlayer(netId: number): void {
    const entity = this.byNetId.get(netId);
    if (entity === undefined) return;
    const wasHunter = this.world.getOrThrow(entity, Player).role === 'hunter';
    this.world.destroyEntity(entity);
    this.byNetId.delete(netId);

    // A mid-round departure must still resolve the round.
    if (this.roundActive()) {
      if (wasHunter) this.endRound('hiders');
      else this.checkWinConditions();
    }
  }

  setReady(netId: number, ready: boolean): void {
    const entity = this.byNetId.get(netId);
    if (entity !== undefined) this.world.getOrThrow(entity, Player).ready = ready;
  }

  allReady(): boolean {
    return this.players().every((p) => this.world.getOrThrow(p, Player).ready);
  }

  // ── Round control ─────────────────────────────────────────────────────────

  /** Host-triggered. Returns false if the round cannot start. */
  startRound(): boolean {
    if (this._phase !== GamePhase.Waiting) return false;
    const players = this.players();
    if (players.length < this.config.round.minPlayers) return false;

    // Reset everyone and pick the hunter uniformly at random.
    const hunterIndex = Math.floor(this.rng() * players.length);
    this.nextSpawnIndex = 0;
    let hunterNetId = -1;

    players.forEach((entity, i) => {
      const player = this.world.getOrThrow(entity, Player);
      const t = this.world.getOrThrow(entity, Transform);
      const disguise = this.world.getOrThrow(entity, Disguise);
      player.alive = true;
      disguise.propType = PropType.None;
      disguise.propId = -1;
      disguise.locked = false;
      disguise.swapsLeft = this.config.props.maxSwaps;

      if (i === hunterIndex) {
        player.role = 'hunter';
        hunterNetId = player.netId;
        this.world.add(entity, Hunter, { hp: this.config.hunter.hp });
        vec3Set(t.pos, this.map.hunterSpawn.x, 0, this.map.hunterSpawn.z);
        t.yaw = this.map.hunterSpawn.yaw;
      } else {
        player.role = 'hider';
        this.world.remove(entity, Hunter);
        const spawn =
          this.map.hiderSpawns[this.nextSpawnIndex++ % this.map.hiderSpawns.length] ??
          this.map.hunterSpawn;
        vec3Set(t.pos, spawn.x, 0, spawn.z);
        t.yaw = spawn.yaw;
      }
    });

    this.pendingEvents.push({ type: 'roleAssigned', hunterNetId });
    this.enterPhase(GamePhase.Preparation, this.config.round.preparationSeconds);
    return true;
  }

  // ── Input ─────────────────────────────────────────────────────────────────

  /** Accept a redundant batch of input commands from one player. */
  queueInput(netId: number, commands: readonly InputCommand[]): void {
    const entity = this.byNetId.get(netId);
    if (entity === undefined) return;
    const iq = this.world.getOrThrow(entity, InputQueue);
    for (const cmd of commands) {
      // Accept strictly-newer sequences only (dedupes the redundancy overlap).
      if (cmd.seq > iq.lastQueuedSeq) {
        iq.lastQueuedSeq = cmd.seq;
        iq.queue.push(cmd);
      }
    }
  }

  // ── Tick ──────────────────────────────────────────────────────────────────

  /** Advance one fixed tick; returns the events that occurred. */
  step(): SimEvent[] {
    this._tick++;
    const dt = 1 / this.config.tickRate;

    for (const entity of this.players()) {
      this.stepPlayerEntity(entity, dt);
    }

    // Forced taunts fire before the phase timer advances (so they only ever
    // occur while genuinely in the Hunt, never on the transition tick).
    if (this._phase === GamePhase.Hunting) this.tickAutoTaunts();

    this.tickPhaseTimer();
    if (this._phase === GamePhase.Hunting) this.checkWinConditions();

    const events = this.pendingEvents;
    this.pendingEvents = [];
    return events;
  }

  // ── Authoritative state export ────────────────────────────────────────────

  records(): EntityRecord[] {
    return this.players().map((entity) => {
      const player = this.world.getOrThrow(entity, Player);
      const t = this.world.getOrThrow(entity, Transform);
      const disguise = this.world.getOrThrow(entity, Disguise);
      const hunter = this.world.get(entity, Hunter);
      return {
        netId: player.netId,
        x: t.pos.x,
        z: t.pos.z,
        yaw: t.yaw,
        alive: player.alive,
        role: player.role,
        propType: disguise.propType,
        locked: disguise.locked,
        health: hunter ? Math.max(0, hunter.hp) : 255,
      };
    });
  }

  lastProcessedSeq(netId: number): number {
    const entity = this.byNetId.get(netId);
    if (entity === undefined) return -1;
    return this.world.getOrThrow(entity, InputQueue).lastProcessedSeq;
  }

  rosterNames(): { netId: number; name: string; ready: boolean }[] {
    return this.players().map((e) => {
      const p = this.world.getOrThrow(e, Player);
      return { netId: p.netId, name: p.name, ready: p.ready };
    });
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private players(): Entity[] {
    return this.world.query(Player, Transform, Disguise, InputQueue);
  }

  private roundActive(): boolean {
    return (
      this._phase === GamePhase.Preparation ||
      this._phase === GamePhase.Hiding ||
      this._phase === GamePhase.Hunting
    );
  }

  private stepPlayerEntity(entity: Entity, dt: number): void {
    const iq = this.world.getOrThrow(entity, InputQueue);
    const player = this.world.getOrThrow(entity, Player);
    const t = this.world.getOrThrow(entity, Transform);

    const hunter = this.world.get(entity, Hunter);
    if (hunter && hunter.cooldownTicks > 0) hunter.cooldownTicks--;
    if (iq.tauntCooldownTicks > 0) iq.tauntCooldownTicks--;

    // Consume queued inputs in order (bounded per tick so a backlog can't stall the sim).
    const budget = Math.min(iq.queue.length, this.config.net.maxInputsPerTick);
    for (let i = 0; i < budget; i++) {
      const cmd = iq.queue.shift()!;
      const speed = this.resolveSpeed(entity);
      stepPlayer(t, cmd, this.collision, this.config.player.radius, speed, dt);

      // Edge-detect buttons (pressed this command, not held from the previous one).
      const pressed = cmd.buttons & ~iq.lastButtons;
      iq.lastButtons = cmd.buttons;
      if (pressed & Buttons.Attack) this.tryAttack(entity);
      if (pressed & Buttons.Possess) this.tryPossess(entity);
      if (pressed & Buttons.Lock) this.tryToggleLock(entity);
      if (pressed & Buttons.Taunt) this.tryTaunt(entity);

      iq.lastProcessedSeq = cmd.seq;
    }

    // Keep dead players' look responsive but discard stale movement backlog.
    if (!player.alive && iq.queue.length > this.config.net.maxInputsPerTick) {
      iq.queue.length = 0;
    }
  }

  private resolveSpeed(entity: Entity): number {
    const player = this.world.getOrThrow(entity, Player);
    const disguise = this.world.getOrThrow(entity, Disguise);
    // Shared with client prediction (game/speed.ts) — never fork this logic.
    return resolveSpeed(
      this.config,
      this._phase,
      player.role,
      player.alive,
      disguise.propType,
      disguise.locked,
    );
  }

  private tryAttack(entity: Entity): void {
    const player = this.world.getOrThrow(entity, Player);
    const hunter = this.world.get(entity, Hunter);
    if (!player.alive || player.role !== 'hunter' || !hunter) return;
    if (this._phase !== GamePhase.Hunting) return;
    if (hunter.cooldownTicks > 0) return;
    hunter.cooldownTicks = Math.round(
      this.config.hunter.attackCooldownSeconds * this.config.tickRate,
    );

    const t = this.world.getOrThrow(entity, Transform);
    const ox = t.pos.x;
    const oz = t.pos.z;
    const aimX = Math.sin(t.yaw);
    const aimZ = Math.cos(t.yaw);
    const range = this.config.hunter.attackRange;
    // The swing is a thin CONE around the crosshair, not a hairline ray: a target
    // hits if it's within `aimAssistDegrees` (plus its own radius) of the aim line
    // AND in clear line of sight. We connect with the MOST on-axis candidate, so a
    // stray innocent prop off to the side can't steal a swing aimed at a hider.
    const tanAssist = Math.tan((this.config.hunter.aimAssistDegrees * Math.PI) / 180);

    // Tracked best across players + props (angular deviation primary, distance tiebreak).
    const best = { angle: Infinity, dist: Infinity, victim: null as Entity | null, propId: -1 };

    const consider = (cx: number, cz: number, radius: number, who: Entity | null, propId: number) => {
      const lx = cx - ox;
      const lz = cz - oz;
      const tca = lx * aimX + lz * aimZ; // forward projection along the aim line
      if (tca <= 0) return; // behind the hunter
      const L = Math.hypot(lx, lz);
      if (L - radius > range) return; // nearest surface beyond reach
      const perp = Math.abs(aimX * lz - aimZ * lx); // lateral offset from the aim line
      if (perp > radius + tanAssist * tca) return; // outside the swing cone
      // Line of sight: a wall in front of the target's near surface blocks the hit.
      if (raycastWalls(ox, oz, lx / L, lz / L, this.collision) < L - radius) return;
      const angle = L <= radius ? 0 : perp / L; // ~sin(off-axis angle); smaller = more centered
      if (angle < best.angle - 1e-6 || (angle <= best.angle + 1e-6 && tca < best.dist)) {
        best.angle = angle;
        best.dist = tca;
        best.victim = who;
        best.propId = propId;
      }
    };

    for (const other of this.players()) {
      if (other === entity) continue;
      const op = this.world.getOrThrow(other, Player);
      if (!op.alive) continue;
      const ot = this.world.getOrThrow(other, Transform);
      const od = this.world.getOrThrow(other, Disguise);
      const radius =
        od.propType === PropType.None ? this.config.player.radius : PROP_RADIUS[od.propType];
      consider(ot.pos.x, ot.pos.z, radius, other, -1);
    }

    for (const prop of this.map.props) {
      consider(prop.x, prop.z, PROP_RADIUS[prop.type], null, prop.id);
    }

    const victim = best.victim;
    const hitPropId = best.propId;

    if (victim !== null) {
      const vp = this.world.getOrThrow(victim, Player);
      vp.alive = false;
      this.pendingEvents.push({
        type: 'attack',
        attackerNetId: player.netId,
        victimNetId: vp.netId,
        hunterHp: hunter.hp,
      });
      this.pendingEvents.push({ type: 'eliminated', netId: vp.netId, byNetId: player.netId });
      return;
    }

    if (hitPropId >= 0) {
      hunter.hp -= this.config.hunter.wrongPropDamage;
      this.pendingEvents.push({
        type: 'attack',
        attackerNetId: player.netId,
        hitPropId,
        hunterHp: Math.max(0, hunter.hp),
      });
      if (hunter.hp <= 0) this.endRound('hiders');
      return;
    }

    // Swung at air/wall: no penalty, but still an event so clients can play FX.
    this.pendingEvents.push({ type: 'attack', attackerNetId: player.netId, hunterHp: hunter.hp });
  }

  private tryPossess(entity: Entity): void {
    const player = this.world.getOrThrow(entity, Player);
    const disguise = this.world.getOrThrow(entity, Disguise);
    if (!player.alive || player.role !== 'hider') return;
    if (this._phase !== GamePhase.Hiding && this._phase !== GamePhase.Hunting) return;
    if (disguise.swapsLeft <= 0) return;

    const t = this.world.getOrThrow(entity, Transform);
    const rangeSq = this.config.props.possessRange ** 2;
    let nearest: { id: number; type: PropType } | null = null;
    let nearestDistSq = rangeSq;
    for (const prop of this.map.props) {
      if (prop.id === disguise.propId) continue; // must pick a different prop
      const dx = prop.x - t.pos.x;
      const dz = prop.z - t.pos.z;
      const distSq = dx * dx + dz * dz;
      if (distSq < nearestDistSq) {
        nearestDistSq = distSq;
        nearest = { id: prop.id, type: prop.type };
      }
    }
    if (!nearest) return;

    disguise.propType = nearest.type;
    disguise.propId = nearest.id;
    disguise.locked = false;
    disguise.swapsLeft--;
    this.pendingEvents.push({
      type: 'possessed',
      netId: player.netId,
      propType: nearest.type,
      propId: nearest.id,
      swapsLeft: disguise.swapsLeft,
    });
  }

  private tryToggleLock(entity: Entity): void {
    const player = this.world.getOrThrow(entity, Player);
    const disguise = this.world.getOrThrow(entity, Disguise);
    if (!player.alive || disguise.propType === PropType.None) return;
    disguise.locked = !disguise.locked;
    this.pendingEvents.push({
      type: 'lockChanged',
      netId: player.netId,
      locked: disguise.locked,
    });
  }

  /**
   * MANUAL "bait" taunt (button). Voluntary self-reveal used to lure the hunter
   * into swinging near you (a wrong swing costs them HP). Optional on top of the
   * forced auto-taunts below — firing it also resets the auto timer so you don't
   * double-shout immediately after.
   */
  private tryTaunt(entity: Entity): void {
    const player = this.world.getOrThrow(entity, Player);
    const iq = this.world.getOrThrow(entity, InputQueue);
    if (!player.alive || player.role !== 'hider') return;
    if (this._phase !== GamePhase.Hunting) return;
    if (iq.tauntCooldownTicks > 0) return;
    iq.tauntCooldownTicks = Math.round(
      this.config.props.tauntCooldownSeconds * this.config.tickRate,
    );
    this.emitTaunt(entity);
    iq.autoTauntTicks = this.autoTauntIntervalTicks();
  }

  /**
   * FORCED taunts — the fairness engine. Every alive hider periodically emits a
   * positional taunt so a perfectly-locked hider can still be found. The interval
   * escalates as the hunt clock runs down (spread out early, frequent late) to
   * push endgames toward resolution instead of stalling.
   */
  private tickAutoTaunts(): void {
    for (const entity of this.players()) {
      const player = this.world.getOrThrow(entity, Player);
      if (player.role !== 'hider' || !player.alive) continue;
      const iq = this.world.getOrThrow(entity, InputQueue);
      if (--iq.autoTauntTicks > 0) continue;
      this.emitTaunt(entity);
      iq.autoTauntTicks = this.autoTauntIntervalTicks();
    }
  }

  /** Seed each hider's first forced taunt, staggered so they don't all shout at once. */
  private initAutoTaunts(): void {
    const interval = this.autoTauntIntervalTicks();
    for (const entity of this.players()) {
      const player = this.world.getOrThrow(entity, Player);
      const iq = this.world.getOrThrow(entity, InputQueue);
      // Stagger across 35–100% of the interval; the exact-same tick would reveal
      // every hider simultaneously and drown the positional cue.
      iq.autoTauntTicks =
        player.role === 'hider' ? Math.max(1, Math.round(interval * (0.35 + 0.65 * this.rng()))) : 0;
    }
  }

  /** Escalating interval: full at the start of the hunt, shrinking to the floor at the end. */
  private autoTauntIntervalTicks(): number {
    const { tickRate } = this.config;
    const max = this.config.props.tauntIntervalSeconds;
    const min = this.config.props.tauntMinIntervalSeconds;
    const huntingTotal = Math.max(1, Math.round(this.config.round.huntingSeconds * tickRate));
    const fractionRemaining = clamp01(this.phaseTicksLeft / huntingTotal);
    const seconds = min + (max - min) * fractionRemaining;
    return Math.max(1, Math.round(seconds * tickRate));
  }

  private emitTaunt(entity: Entity): void {
    const player = this.world.getOrThrow(entity, Player);
    const t = this.world.getOrThrow(entity, Transform);
    this.pendingEvents.push({ type: 'taunt', netId: player.netId, x: t.pos.x, z: t.pos.z });
  }

  private tickPhaseTimer(): void {
    if (this.phaseTicksLeft < 0) return;
    if (--this.phaseTicksLeft > 0) return;

    switch (this._phase) {
      case GamePhase.Preparation:
        this.enterPhase(GamePhase.Hiding, this.config.round.hidingSeconds);
        break;
      case GamePhase.Hiding:
        this.enterPhase(GamePhase.Hunting, this.config.round.huntingSeconds);
        break;
      case GamePhase.Hunting:
        // Time ran out with hiders alive → hiders win.
        this.endRound('hiders');
        break;
      case GamePhase.RoundEnd:
        this.enterPhase(GamePhase.Waiting, -1);
        // Roles reset in the lobby so the next round re-rolls fairly.
        for (const e of this.players()) {
          const p = this.world.getOrThrow(e, Player);
          p.role = 'hider';
          p.alive = true;
          p.ready = false;
          this.world.remove(e, Hunter);
          const d = this.world.getOrThrow(e, Disguise);
          d.propType = PropType.None;
          d.propId = -1;
          d.locked = false;
        }
        break;
      case GamePhase.Waiting:
        break;
    }
  }

  private checkWinConditions(): void {
    if (this._phase !== GamePhase.Hunting) return;
    const players = this.players();
    const hunterAlive = players.some((e) => {
      const p = this.world.getOrThrow(e, Player);
      return p.role === 'hunter' && p.alive;
    });
    const hidersAlive = players.filter((e) => {
      const p = this.world.getOrThrow(e, Player);
      return p.role === 'hider' && p.alive;
    });

    if (!hunterAlive) this.endRound('hiders');
    else if (hidersAlive.length === 0) this.endRound('hunter');
  }

  private endRound(winner: 'hunter' | 'hiders'): void {
    if (this._phase === GamePhase.RoundEnd || this._phase === GamePhase.Waiting) return;
    const survivors = this.players()
      .filter((e) => {
        const p = this.world.getOrThrow(e, Player);
        return p.role === 'hider' && p.alive;
      })
      .map((e) => this.world.getOrThrow(e, Player).netId);
    this.pendingEvents.push({ type: 'roundEnd', winner, survivors });
    this.enterPhase(GamePhase.RoundEnd, this.config.round.roundEndSeconds);
  }

  private enterPhase(phase: GamePhase, durationSeconds: number): void {
    this._phase = phase;
    this.phaseTicksLeft =
      durationSeconds < 0 ? -1 : Math.max(1, Math.round(durationSeconds * this.config.tickRate));
    if (phase === GamePhase.Hunting) this.initAutoTaunts();
    this.pendingEvents.push({
      type: 'phase',
      phase,
      durationTicks: this.phaseTicksLeft,
    });
  }
}
