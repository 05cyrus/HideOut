/**
 * End-to-end multiplayer integration over loopback transports:
 * one HostSession + two ClientSessions play a complete round — join, ready,
 * role assignment, prediction/reconciliation, possession, elimination, and
 * round end — with deterministic message delivery, including a packet-loss run.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { HostSession } from './HostSession';
import { ClientSession } from './ClientSession';
import type { GameSession } from './types';
import { createLoopbackPair, type LoopbackPair } from '../transport/LoopbackTransport';
import { testBoxMap, testBoxConfig } from '../../game/maps/testbox';
import { Buttons, GamePhase } from '../../game/types';
import type { InputCommand, SimEvent } from '../../game/types';

const maps = { [testBoxMap.id]: testBoxMap };

interface Rig {
  host: HostSession;
  c1: ClientSession;
  c2: ClientSession;
  pairs: LoopbackPair[];
  simEvents: Map<GameSession, SimEvent[]>;
  seqs: Map<GameSession, number>;
}

let rig: Rig;

function makeRig(options: { unreliableLoss?: number } = {}): Rig {
  const host = new HostSession({
    roomName: 'Test Room',
    hostName: 'Host',
    map: testBoxMap,
    config: testBoxConfig,
    seed: 7,
  });
  const pair1 = createLoopbackPair({ unreliableLoss: options.unreliableLoss, seed: 11 });
  const pair2 = createLoopbackPair({ unreliableLoss: options.unreliableLoss, seed: 22 });
  host.attachPeer(pair1.a);
  host.attachPeer(pair2.a);
  const c1 = new ClientSession(pair1.b, 'Alice', maps, testBoxConfig, () => 0);
  const c2 = new ClientSession(pair2.b, 'Bob', maps, testBoxConfig, () => 0);

  const simEvents = new Map<GameSession, SimEvent[]>([
    [host, []],
    [c1, []],
    [c2, []],
  ]);
  for (const s of [host, c1, c2] as GameSession[]) {
    s.events.on('sim', (e) => simEvents.get(s)!.push(e));
  }

  const r: Rig = {
    host,
    c1,
    c2,
    pairs: [pair1, pair2],
    simEvents,
    seqs: new Map([
      [host as GameSession, -1],
      [c1 as GameSession, -1],
      [c2 as GameSession, -1],
    ]),
  };
  flush(r); // join → welcome → roster
  return r;
}

function flush(r: Rig): void {
  // Deliver until quiet (joins can trigger responses that trigger more sends).
  for (let i = 0; i < 4; i++) for (const p of r.pairs) p.flush();
}

function cmdFor(r: Rig, s: GameSession, partial: Partial<InputCommand> = {}): InputCommand {
  const seq = r.seqs.get(s)! + 1;
  r.seqs.set(s, seq);
  return { seq, moveX: 0, moveZ: 0, yaw: 0, pitch: 0, buttons: 0, ...partial };
}

/**
 * One full network tick, mirroring the real frame loop:
 * clients submit inputs (predict + send) → host receives → host steps + sends
 * → clients receive → clients advance interpolation.
 */
function tickAll(r: Rig, inputs?: Map<GameSession, Partial<InputCommand>>): void {
  const dt = 1 / testBoxConfig.tickRate;
  for (const s of [r.c1, r.c2] as GameSession[]) {
    s.submitLocalInput(cmdFor(r, s, inputs?.get(s) ?? {}));
    s.fixedTick();
  }
  r.host.submitLocalInput(cmdFor(r, r.host, inputs?.get(r.host) ?? {}));
  flush(r); // client packets → host
  r.host.fixedTick(); // sim step + snapshots + events
  flush(r); // host packets → clients
  for (const s of [r.c1, r.c2]) s.frame(dt);
}

function runTicks(r: Rig, n: number, inputs?: Map<GameSession, Partial<InputCommand>>): void {
  for (let i = 0; i < n; i++) tickAll(r, inputs);
}

function toPhase(r: Rig, phase: GamePhase): void {
  for (let i = 0; i < 300 && r.host.phaseInfo().phase !== phase; i++) tickAll(r);
  expect(r.host.phaseInfo().phase).toBe(phase);
}

function startRound(r: Rig): { hunter: GameSession; hiders: GameSession[] } {
  r.c1.setReady(true);
  r.c2.setReady(true);
  flush(r);
  expect(r.host.startRound()).toBe(true);
  tickAll(r);
  const role = r.simEvents.get(r.host)!.find((e) => e.type === 'roleAssigned');
  if (!role || role.type !== 'roleAssigned') throw new Error('no roleAssigned');
  const all: GameSession[] = [r.host, r.c1, r.c2];
  const hunter = all.find((s) => s.localNetId === role.hunterNetId)!;
  return { hunter, hiders: all.filter((s) => s !== hunter) };
}

function recordOf(s: GameSession, netId: number) {
  const rec = s.views().find((v) => v.netId === netId);
  if (!rec) throw new Error(`no view for ${netId} on ${s.isHost ? 'host' : 'client'}`);
  return rec;
}

beforeEach(() => {
  rig = makeRig();
});

describe('sessions — lobby', () => {
  it('joins both clients and syncs the roster everywhere', () => {
    expect(rig.c1.localNetId).toBe(1);
    expect(rig.c2.localNetId).toBe(2);
    for (const s of [rig.host, rig.c1, rig.c2]) {
      const names = s
        .roster()
        .map((r) => r.name)
        .sort();
      expect(names).toEqual(['Alice', 'Bob', 'Host']);
    }
  });

  it('propagates ready state to every peer', () => {
    rig.c1.setReady(true);
    flush(rig);
    for (const s of [rig.host, rig.c1, rig.c2]) {
      expect(s.roster().find((r) => r.netId === 1)?.ready).toBe(true);
      expect(s.roster().find((r) => r.netId === 2)?.ready).toBe(false);
    }
  });

  it('removes a leaving client from every roster', () => {
    rig.c2.leave();
    flush(rig);
    expect(
      rig.host
        .roster()
        .map((r) => r.netId)
        .sort(),
    ).toEqual([0, 1]);
    expect(
      rig.c1
        .roster()
        .map((r) => r.netId)
        .sort(),
    ).toEqual([0, 1]);
  });
});

describe('sessions — round flow', () => {
  it('assigns one hunter and mirrors phase transitions to clients', () => {
    startRound(rig);
    for (const s of [rig.c1, rig.c2]) {
      expect(s.phaseInfo().phase).toBe(GamePhase.Preparation);
      expect(rig.simEvents.get(s)!.some((e) => e.type === 'roleAssigned')).toBe(true);
    }
    toPhase(rig, GamePhase.Hunting);
    expect(rig.c1.phaseInfo().phase).toBe(GamePhase.Hunting);
    expect(rig.c1.phaseInfo().secondsLeft).toBeGreaterThan(0);
  });

  it('client prediction matches host authority for a moving hider', () => {
    const { hiders } = startRound(rig);
    const hiderClient = hiders.find((s) => !s.isHost) as ClientSession;
    toPhase(rig, GamePhase.Hiding);

    runTicks(rig, 4, new Map([[hiderClient, { moveZ: 1, yaw: 1.1 }]]));

    const predicted = recordOf(hiderClient, hiderClient.localNetId);
    const authoritative = recordOf(rig.host, hiderClient.localNetId);
    // Zero-latency loopback: prediction must match authority within quantization.
    expect(predicted.x).toBeCloseTo(authoritative.x, 1);
    expect(predicted.z).toBeCloseTo(authoritative.z, 1);
  });

  it('full round: possession, elimination, hider survival → hiders win on timeout', () => {
    const { hunter, hiders } = startRound(rig);
    toPhase(rig, GamePhase.Hiding);

    // First hider (spawn 9,0 near the barrel) possesses it.
    const nearHider = hiders[0]!;
    tickAll(rig, new Map([[nearHider, { buttons: Buttons.Possess }]]));
    tickAll(rig); // button release edge
    const possessed = rig.simEvents.get(rig.c1)!.find((e) => e.type === 'possessed');
    expect(possessed).toBeDefined();
    // Every session sees the hider's record as a barrel now.
    for (const s of [rig.host, rig.c1, rig.c2]) {
      expect(recordOf(s, nearHider.localNetId).propType).toBeGreaterThan(0);
    }

    toPhase(rig, GamePhase.Hunting);

    // Hunter turns toward the second hider (spawn −2,0) and attacks.
    const farView = recordOf(rig.host, hiders[1]!.localNetId);
    const hunterView = recordOf(rig.host, hunter.localNetId);
    const yaw = Math.atan2(farView.x - hunterView.x, farView.z - hunterView.z);
    tickAll(rig, new Map([[hunter, { buttons: Buttons.Attack, yaw }]]));
    tickAll(rig);

    for (const s of [rig.host, rig.c1, rig.c2]) {
      expect(
        rig.simEvents
          .get(s)!
          .some((e) => e.type === 'eliminated' && e.netId === hiders[1]!.localNetId),
      ).toBe(true);
      expect(recordOf(s, hiders[1]!.localNetId).alive).toBe(false);
    }

    // Let the hunt time out — the disguised hider survives.
    runTicks(rig, 60);
    for (const s of [rig.host, rig.c1, rig.c2]) {
      const end = rig.simEvents.get(s)!.find((e) => e.type === 'roundEnd');
      expect(end).toBeDefined();
      if (end?.type === 'roundEnd') {
        expect(end.winner).toBe('hiders');
        expect(end.survivors).toEqual([nearHider.localNetId]);
      }
    }
  });

  it('remote entities interpolate (client sees others move smoothly)', () => {
    startRound(rig);
    toPhase(rig, GamePhase.Hiding);

    // Move the host player (a hider or frozen hunter — pick whoever moves: use c1's
    // view of ALL remotes; at least one remote must change position over time if the
    // host is a hider; if host is the hunter, drive c2 instead).
    const hostIsHunter = recordOf(rig.host, 0).role === 'hunter';
    const mover: GameSession = hostIsHunter ? rig.c2 : rig.host;
    const before = recordOf(rig.c1, mover.localNetId);
    runTicks(rig, 8, new Map([[mover, { moveZ: 1 }]]));
    const after = recordOf(rig.c1, mover.localNetId);
    const moved = Math.hypot(after.x - before.x, after.z - before.z);
    expect(moved).toBeGreaterThan(0.5); // observed through the interpolator
  });

  it('keeps the host ready after a round so it can start the next one', () => {
    // Regression: the sim clears every ready flag on returning to the lobby.
    // The host has no Ready button, so if its flag were not re-asserted the
    // "Start Round" gate would be permanently disabled after the first round.
    startRound(rig);
    toPhase(rig, GamePhase.Waiting);

    const hostReady = (s: GameSession) => s.roster().find((r) => r.netId === 0)?.ready;
    expect(hostReady(rig.host)).toBe(true);
    // …and the fresh ready state has propagated to every client's roster.
    expect(hostReady(rig.c1)).toBe(true);
    expect(hostReady(rig.c2)).toBe(true);

    // Clients were reset to not-ready; the host re-readies them and starts again.
    expect(rig.c1.roster().find((r) => r.netId === 1)?.ready).toBe(false);
    rig.c1.setReady(true);
    rig.c2.setReady(true);
    flush(rig);
    expect(rig.host.startRound()).toBe(true);
  });
});

describe('sessions — packet loss resilience', () => {
  it('survives 30% unreliable loss: prediction reconciles, state converges', () => {
    const lossy = makeRig({ unreliableLoss: 0.3 });
    const { hiders } = startRound(lossy);
    const hiderClient = hiders.find((s) => !s.isHost) as ClientSession;
    toPhase(lossy, GamePhase.Hiding);

    runTicks(lossy, 30, new Map([[hiderClient, { moveZ: 1, yaw: 0.4 }]]));

    const predicted = recordOf(hiderClient, hiderClient.localNetId);
    const authoritative = recordOf(lossy.host, hiderClient.localNetId);
    // Input redundancy + reconciliation keep client and host in agreement.
    expect(predicted.x).toBeCloseTo(authoritative.x, 0);
    expect(predicted.z).toBeCloseTo(authoritative.z, 0);

    // Remote view still tracks through loss (interpolator holds/resumes).
    const seenByOther = recordOf(
      lossy.c2 === hiderClient ? lossy.c1 : lossy.c2,
      hiderClient.localNetId,
    );
    expect(
      Math.hypot(seenByOther.x - authoritative.x, seenByOther.z - authoritative.z),
    ).toBeLessThan(3);
  });
});
