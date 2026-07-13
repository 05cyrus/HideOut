import { describe, it, expect } from 'vitest';
import { HostSimulation } from './HostSimulation';
import { GamePhase, PropType, Buttons } from './types';
import type { InputCommand, SimEvent } from './types';
import { withConfig } from './config';
import { testBoxMap as testMap, testBoxConfig as cfg } from './maps/testbox';

/** Per-player sequence bookkeeping + convenience input drivers. */
class Driver {
  private seqs = new Map<number, number>();

  constructor(private readonly sim: HostSimulation) {}

  cmd(netId: number, partial: Partial<InputCommand> = {}): InputCommand {
    const seq = (this.seqs.get(netId) ?? -1) + 1;
    this.seqs.set(netId, seq);
    return { seq, moveX: 0, moveZ: 0, yaw: 0, pitch: 0, buttons: 0, ...partial };
  }

  /** Queue press+release in one tick (edge-detected once), then step. */
  press(netId: number, button: Buttons, extra: Partial<InputCommand> = {}): SimEvent[] {
    this.sim.queueInput(this.sim === undefined ? netId : netId, [
      this.cmd(netId, { buttons: button, ...extra }),
      this.cmd(netId, { buttons: 0, ...extra }),
    ]);
    return this.sim.step();
  }

  /** Drive movement for N ticks. */
  move(netId: number, ticks: number, input: Partial<InputCommand>): SimEvent[] {
    const events: SimEvent[] = [];
    for (let i = 0; i < ticks; i++) {
      this.sim.queueInput(netId, [this.cmd(netId, input)]);
      events.push(...this.sim.step());
    }
    return events;
  }

  run(ticks: number): SimEvent[] {
    const events: SimEvent[] = [];
    for (let i = 0; i < ticks; i++) events.push(...this.sim.step());
    return events;
  }
}

interface Setup {
  sim: HostSimulation;
  d: Driver;
  hunterId: number;
  hiderA: number; // spawned at (9, 0), near the barrel
  hiderB: number; // spawned at (-2, 0), west of the hunter
}

/** Start a 3-player round and identify roles from the roleAssigned event. */
function startRound(seed = 1): Setup {
  const sim = new HostSimulation(testMap, cfg, seed);
  sim.addPlayer(0, 'P0');
  sim.addPlayer(1, 'P1');
  sim.addPlayer(2, 'P2');
  expect(sim.startRound()).toBe(true);
  const d = new Driver(sim);
  const events = sim.step(); // drains roleAssigned + phase events
  const role = events.find((e) => e.type === 'roleAssigned');
  if (!role || role.type !== 'roleAssigned') throw new Error('no roleAssigned event');
  const hunterId = role.hunterNetId;
  const hiders = [0, 1, 2].filter((id) => id !== hunterId);
  return { sim, d, hunterId, hiderA: hiders[0]!, hiderB: hiders[1]! };
}

function toPhase(setup: Setup, phase: GamePhase): void {
  for (let i = 0; i < 200 && setup.sim.phase !== phase; i++) setup.sim.step();
  expect(setup.sim.phase).toBe(phase);
}

function record(setup: Setup, netId: number) {
  const r = setup.sim.records().find((r) => r.netId === netId);
  if (!r) throw new Error(`no record for ${netId}`);
  return r;
}

describe('HostSimulation — roster & round start', () => {
  it('refuses to start below minPlayers or outside Waiting', () => {
    const sim = new HostSimulation(testMap, cfg, 1);
    sim.addPlayer(0, 'Solo');
    expect(sim.startRound()).toBe(false);
    sim.addPlayer(1, 'P1');
    expect(sim.startRound()).toBe(true);
    expect(sim.startRound()).toBe(false); // already running
  });

  it('assigns exactly one hunter and spawns roles at their spawn points', () => {
    const s = startRound();
    const records = s.sim.records();
    expect(records.filter((r) => r.role === 'hunter')).toHaveLength(1);
    const hunter = record(s, s.hunterId);
    expect(hunter.x).toBeCloseTo(0);
    expect(hunter.z).toBeCloseTo(0);
    expect(record(s, s.hiderA).x).toBeCloseTo(9);
    expect(record(s, s.hiderB).x).toBeCloseTo(-2);
  });

  it('rejects duplicate netIds', () => {
    const sim = new HostSimulation(testMap, cfg, 1);
    sim.addPlayer(0, 'A');
    expect(() => sim.addPlayer(0, 'B')).toThrow();
  });
});

describe('HostSimulation — phase flow', () => {
  it('advances Preparation → Hiding → Hunting on timers', () => {
    const s = startRound();
    expect(s.sim.phase).toBe(GamePhase.Preparation);
    const events = s.d.run(2); // ticks 2..3 of the 3-tick prep
    expect(events.some((e) => e.type === 'phase' && e.phase === GamePhase.Hiding)).toBe(true);
    const more = s.d.run(5);
    expect(more.some((e) => e.type === 'phase' && e.phase === GamePhase.Hunting)).toBe(true);
  });

  it('hunting timeout → hiders win with surviving netIds', () => {
    const s = startRound();
    toPhase(s, GamePhase.Hunting);
    const events = s.d.run(50);
    const end = events.find((e) => e.type === 'roundEnd');
    expect(end).toBeDefined();
    if (end?.type === 'roundEnd') {
      expect(end.winner).toBe('hiders');
      expect(end.survivors.sort()).toEqual([s.hiderA, s.hiderB].sort());
    }
    // RoundEnd then returns to Waiting and clears roles.
    toPhase(s, GamePhase.Waiting);
    expect(s.sim.records().every((r) => r.role === 'hider')).toBe(true);
  });

  it('freezes everyone during Preparation and the hunter during Hiding', () => {
    const s = startRound();
    // Preparation: hider movement ignored.
    s.d.move(s.hiderB, 1, { moveZ: 1 });
    expect(record(s, s.hiderB).z).toBeCloseTo(0);

    toPhase(s, GamePhase.Hiding);
    // Hunter frozen; hider moves.
    s.d.move(s.hunterId, 1, { moveZ: 1 });
    expect(record(s, s.hunterId).z).toBeCloseTo(0);
    s.d.move(s.hiderB, 1, { moveZ: -1 });
    expect(record(s, s.hiderB).z).toBeLessThan(0);
  });
});

describe('HostSimulation — possession', () => {
  it('lets a hider possess the nearest prop in range, consuming a swap', () => {
    const s = startRound();
    toPhase(s, GamePhase.Hiding);
    // hiderA is at (9,0), 1m from the barrel (id 2).
    const events = s.d.press(s.hiderA, Buttons.Possess);
    const possessed = events.find((e) => e.type === 'possessed');
    expect(possessed).toBeDefined();
    if (possessed?.type === 'possessed') {
      expect(possessed.netId).toBe(s.hiderA);
      expect(possessed.propType).toBe(PropType.Barrel);
      expect(possessed.propId).toBe(2);
      expect(possessed.swapsLeft).toBe(1); // maxSwaps 2 − 1
    }
    expect(record(s, s.hiderA).propType).toBe(PropType.Barrel);
  });

  it('denies possession out of range, for hunters, and during Preparation', () => {
    const s = startRound();
    // During Preparation: nothing.
    expect(s.d.press(s.hiderA, Buttons.Possess).some((e) => e.type === 'possessed')).toBe(false);

    toPhase(s, GamePhase.Hiding);
    // hiderB at (-2,0): nearest prop is >2.5m away → nothing.
    expect(s.d.press(s.hiderB, Buttons.Possess).some((e) => e.type === 'possessed')).toBe(false);
    // Hunter can never possess.
    expect(s.d.press(s.hunterId, Buttons.Possess).some((e) => e.type === 'possessed')).toBe(false);
  });

  it('cannot re-possess the same prop, and lock freezes movement', () => {
    const s = startRound();
    toPhase(s, GamePhase.Hiding);
    s.d.press(s.hiderA, Buttons.Possess);
    // Same prop is excluded and everything else is out of range → no second possess.
    expect(s.d.press(s.hiderA, Buttons.Possess).some((e) => e.type === 'possessed')).toBe(false);

    // Lock → frozen.
    const lockEvents = s.d.press(s.hiderA, Buttons.Lock);
    expect(lockEvents.some((e) => e.type === 'lockChanged' && e.locked)).toBe(true);
    const before = record(s, s.hiderA).x;
    s.d.move(s.hiderA, 2, { moveZ: 1 });
    expect(record(s, s.hiderA).x).toBeCloseTo(before);

    // Unlock → moves again (at disguised speed).
    s.d.press(s.hiderA, Buttons.Lock);
    s.d.move(s.hiderA, 2, { moveZ: 1 });
    expect(record(s, s.hiderA).z).toBeGreaterThan(0);
  });
});

describe('HostSimulation — combat', () => {
  it('eliminates a player hit by the hunter ray', () => {
    const s = startRound();
    toPhase(s, GamePhase.Hunting);
    // hiderB is 2m due west; face -X (yaw = -PI/2).
    const events = s.d.press(s.hunterId, Buttons.Attack, { yaw: -Math.PI / 2 });
    expect(events.some((e) => e.type === 'attack' && e.victimNetId === s.hiderB)).toBe(true);
    expect(events.some((e) => e.type === 'eliminated' && e.netId === s.hiderB)).toBe(true);
    expect(record(s, s.hiderB).alive).toBe(false);
  });

  it('costs HP to hit an innocent prop, and 2 wrong hits end the round for the hunter', () => {
    const s = startRound();
    toPhase(s, GamePhase.Hunting);
    // Plant is due south (yaw = PI faces -Z), unobstructed, 4.65m away.
    const first = s.d.press(s.hunterId, Buttons.Attack, { yaw: Math.PI });
    const hit = first.find((e) => e.type === 'attack');
    expect(hit).toBeDefined();
    if (hit?.type === 'attack') {
      expect(hit.hitPropId).toBe(1);
      expect(hit.hunterHp).toBe(50); // 100 − wrongPropDamage(50)
    }

    s.d.run(2); // cooldown
    const second = s.d.press(s.hunterId, Buttons.Attack, { yaw: Math.PI });
    const end = second.find((e) => e.type === 'roundEnd');
    expect(end).toBeDefined();
    if (end?.type === 'roundEnd') expect(end.winner).toBe('hiders');
  });

  it('walls block attacks (no prop penalty through cover) and cooldown gates spam', () => {
    const s = startRound();
    toPhase(s, GamePhase.Hunting);
    // Crate is due north but behind the wall → air swing, no penalty.
    const events = s.d.press(s.hunterId, Buttons.Attack, { yaw: 0 });
    const swing = events.find((e) => e.type === 'attack');
    expect(swing).toBeDefined();
    if (swing?.type === 'attack') {
      expect(swing.hitPropId).toBeUndefined();
      expect(swing.victimNetId).toBeUndefined();
      expect(swing.hunterHp).toBe(100);
    }

    // Immediately attacking again is blocked by cooldown (no attack event).
    const spam = s.d.press(s.hunterId, Buttons.Attack, { yaw: 0 });
    expect(spam.some((e) => e.type === 'attack')).toBe(false);
  });

  it('hunter wins when the last hider falls', () => {
    const s = startRound();
    toPhase(s, GamePhase.Hunting);
    // Kill hiderB (2m west).
    s.d.press(s.hunterId, Buttons.Attack, { yaw: -Math.PI / 2 });
    s.d.run(2);
    // Walk east toward hiderA at (9,0) until in range, then attack.
    s.d.move(s.hunterId, 12, { moveZ: 1, yaw: Math.PI / 2 });
    const events = s.d.press(s.hunterId, Buttons.Attack, { yaw: Math.PI / 2 });
    const end = events.find((e) => e.type === 'roundEnd');
    expect(end).toBeDefined();
    if (end?.type === 'roundEnd') {
      expect(end.winner).toBe('hunter');
      expect(end.survivors).toEqual([]);
    }
  });

  it('hiders cannot attack', () => {
    const s = startRound();
    toPhase(s, GamePhase.Hunting);
    const events = s.d.press(s.hiderB, Buttons.Attack, { yaw: Math.PI / 2 });
    expect(events.some((e) => e.type === 'attack')).toBe(false);
  });
});

describe('HostSimulation — taunt & departures', () => {
  it('taunt broadcasts position and respects its cooldown', () => {
    const s = startRound();
    toPhase(s, GamePhase.Hunting);
    const first = s.d.press(s.hiderB, Buttons.Taunt);
    const taunt = first.find((e) => e.type === 'taunt');
    expect(taunt).toBeDefined();
    if (taunt?.type === 'taunt') {
      expect(taunt.netId).toBe(s.hiderB);
      expect(taunt.x).toBeCloseTo(-2);
    }
    const second = s.d.press(s.hiderB, Buttons.Taunt);
    expect(second.some((e) => e.type === 'taunt')).toBe(false);
  });

  it('hunter leaving mid-round hands the win to hiders', () => {
    const s = startRound();
    toPhase(s, GamePhase.Hunting);
    s.sim.removePlayer(s.hunterId);
    const events = s.sim.step();
    const end = events.find((e) => e.type === 'roundEnd');
    expect(end).toBeDefined();
    if (end?.type === 'roundEnd') expect(end.winner).toBe('hiders');
  });

  it('all hiders leaving hands the win to the hunter', () => {
    const s = startRound();
    toPhase(s, GamePhase.Hunting);
    s.sim.removePlayer(s.hiderA);
    s.sim.removePlayer(s.hiderB);
    const events = s.sim.step();
    const end = events.find((e) => e.type === 'roundEnd');
    expect(end).toBeDefined();
    if (end?.type === 'roundEnd') expect(end.winner).toBe('hunter');
  });
});

describe('HostSimulation — forced auto-taunt', () => {
  // Short, non-escalating interval (min == max == 1s = 10 ticks) for determinism.
  const autoCfg = withConfig({
    tickRate: 10,
    round: {
      preparationSeconds: 0.1,
      hidingSeconds: 0.1,
      huntingSeconds: 10,
      roundEndSeconds: 0.3,
      minPlayers: 2,
    },
    props: {
      possessRange: 2.5,
      maxSwaps: 2,
      tauntCooldownSeconds: 1,
      tauntIntervalSeconds: 1,
      tauntMinIntervalSeconds: 1,
    },
  });

  function startAuto(seed = 3): { sim: HostSimulation; hunterId: number; hiderIds: number[] } {
    const sim = new HostSimulation(testMap, autoCfg, seed);
    sim.addPlayer(0, 'P0');
    sim.addPlayer(1, 'P1');
    sim.addPlayer(2, 'P2');
    expect(sim.startRound()).toBe(true);
    const role = sim.step().find((e) => e.type === 'roleAssigned');
    if (!role || role.type !== 'roleAssigned') throw new Error('no roleAssigned');
    const hunterId = role.hunterNetId;
    return { sim, hunterId, hiderIds: [0, 1, 2].filter((id) => id !== hunterId) };
  }

  function advanceToHunting(sim: HostSimulation): SimEvent[] {
    const collected: SimEvent[] = [];
    for (let i = 0; i < 50 && sim.phase !== GamePhase.Hunting; i++) collected.push(...sim.step());
    expect(sim.phase).toBe(GamePhase.Hunting);
    return collected;
  }

  function collectTaunts(sim: HostSimulation, ticks: number): Set<number> {
    const taunters = new Set<number>();
    for (let i = 0; i < ticks; i++) {
      for (const e of sim.step()) if (e.type === 'taunt') taunters.add(e.netId);
    }
    return taunters;
  }

  it('emits no taunts before the Hunt begins', () => {
    const { sim } = startAuto();
    const pre = advanceToHunting(sim);
    expect(pre.some((e) => e.type === 'taunt')).toBe(false);
  });

  it('every alive hider auto-taunts during the Hunt; the hunter never does', () => {
    const { sim, hunterId, hiderIds } = startAuto();
    advanceToHunting(sim);
    const taunters = collectTaunts(sim, 20);
    expect(taunters.has(hunterId)).toBe(false);
    expect([...taunters].sort()).toEqual([...hiderIds].sort());
  });

  it('stops taunting a hider once eliminated (dead but still present)', () => {
    const { sim, hunterId, hiderIds } = startAuto();
    advanceToHunting(sim);

    // Eliminate whichever hider is inside the hunter's attack range.
    const rec = (id: number) => sim.records().find((r) => r.netId === id)!;
    const h = rec(hunterId);
    const near = hiderIds
      .map((id) => ({ id, r: rec(id) }))
      .sort(
        (a, b) => Math.hypot(a.r.x - h.x, a.r.z - h.z) - Math.hypot(b.r.x - h.x, b.r.z - h.z),
      )[0]!;
    const yaw = Math.atan2(near.r.x - h.x, near.r.z - h.z);
    sim.queueInput(hunterId, [
      { seq: 1000, moveX: 0, moveZ: 0, yaw, pitch: 0, buttons: Buttons.Attack },
      { seq: 1001, moveX: 0, moveZ: 0, yaw, pitch: 0, buttons: 0 },
    ]);
    sim.step();
    expect(rec(near.id).alive).toBe(false);

    const other = hiderIds.find((id) => id !== near.id)!;
    const taunters = collectTaunts(sim, 20);
    expect(taunters.has(near.id)).toBe(false); // eliminated → silent
    expect(taunters.has(other)).toBe(true); // survivor still shouts
  });

  it('manual bait taunt still works and resets the auto timer', () => {
    const { sim, hiderIds } = startAuto();
    advanceToHunting(sim);
    const hider = hiderIds[0]!;
    sim.queueInput(hider, [
      { seq: 2000, moveX: 0, moveZ: 0, yaw: 0, pitch: 0, buttons: Buttons.Taunt },
      { seq: 2001, moveX: 0, moveZ: 0, yaw: 0, pitch: 0, buttons: 0 },
    ]);
    const events = sim.step();
    expect(events.some((e) => e.type === 'taunt' && e.netId === hider)).toBe(true);
  });
});

describe('HostSimulation — input integrity', () => {
  it('drops duplicate/stale sequence numbers (redundant sends apply once)', () => {
    const sim = new HostSimulation(testMap, cfg, 1);
    sim.addPlayer(0, 'A');
    sim.addPlayer(1, 'B');
    const move: InputCommand = { seq: 0, moveX: 0, moveZ: 1, yaw: 0, pitch: 0, buttons: 0 };
    // The same command delivered three times (as redundancy would).
    sim.queueInput(0, [move]);
    sim.queueInput(0, [move]);
    sim.queueInput(0, [move]);
    sim.step();
    const r = sim.records().find((r) => r.netId === 0)!;
    // One tick at walkSpeed 4.5 / 10Hz = 0.45m from spawn (9,0) → z = 0.45, not 1.35.
    expect(r.z).toBeCloseTo(0.45);
  });

  it('echoes lastProcessedSeq for reconciliation', () => {
    const sim = new HostSimulation(testMap, cfg, 1);
    sim.addPlayer(0, 'A');
    sim.addPlayer(1, 'B');
    expect(sim.lastProcessedSeq(0)).toBe(-1);
    sim.queueInput(0, [
      { seq: 0, moveX: 0, moveZ: 1, yaw: 0, pitch: 0, buttons: 0 },
      { seq: 1, moveX: 0, moveZ: 1, yaw: 0, pitch: 0, buttons: 0 },
    ]);
    sim.step();
    expect(sim.lastProcessedSeq(0)).toBe(1);
  });
});
