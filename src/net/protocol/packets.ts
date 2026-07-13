/**
 * Hot-path packet codecs (unreliable channel): input commands and snapshots.
 *
 * Quantization scheme (bandwidth + battery):
 *  - positions:  1/256 m fixed point in an i16 → ±128 m world, 4 mm precision
 *  - yaw:        u16 across [-PI, PI)
 *  - pitch:      i8 across [-PI/2, PI/2]
 *  - move axes:  i8 across [-1, 1]
 *
 * Input packets carry the last N commands redundantly so a lost datagram rarely
 * costs the host an input (the seq dedupe on the host absorbs the overlap).
 *
 * NOTE on deltas: full snapshots for 12 players are ~130 B @30 Hz ≈ 4 KB/s —
 * far under LAN budget, so per-field delta encoding is deferred until entity
 * counts justify it (tracked for Alpha).
 */
import { TAU } from '../../core/math/scalar';
import type { EntityRecord, InputCommand } from '../../game/types';
import { PropType, type Role } from '../../game/types';
import { ByteReader, ByteWriter } from './bytes';

export enum PacketType {
  Input = 1,
  Snapshot = 2,
}

export interface Snapshot {
  tick: number;
  /** Highest input seq the host has simulated for THIS receiver. */
  ackSeq: number;
  entities: EntityRecord[];
}

// ── Quantization helpers ─────────────────────────────────────────────────────

const POS_SCALE = 256;

function quantYaw(yaw: number): number {
  // Map [-PI, PI) → [0, 65535]
  let n = (yaw / TAU + 0.5) % 1;
  if (n < 0) n += 1;
  return Math.round(n * 65535) & 0xffff;
}

function dequantYaw(q: number): number {
  return (q / 65535 - 0.5) * TAU;
}

function quantPitch(pitch: number): number {
  return Math.max(-127, Math.min(127, Math.round((pitch / (Math.PI / 2)) * 127)));
}

function dequantPitch(q: number): number {
  return (q / 127) * (Math.PI / 2);
}

function quantAxis(v: number): number {
  return Math.max(-127, Math.min(127, Math.round(v * 127)));
}

// ── Entity flags ─────────────────────────────────────────────────────────────

const FLAG_ALIVE = 1 << 0;
const FLAG_HUNTER = 1 << 1;
const FLAG_LOCKED = 1 << 2;

// ── Input packets ────────────────────────────────────────────────────────────

export function encodeInputPacket(
  writer: ByteWriter,
  commands: readonly InputCommand[],
): Uint8Array {
  writer.reset();
  writer.u8(PacketType.Input);
  writer.u8(commands.length);
  for (const cmd of commands) {
    writer.u32(cmd.seq);
    writer.i8(quantAxis(cmd.moveX));
    writer.i8(quantAxis(cmd.moveZ));
    writer.u16(quantYaw(cmd.yaw));
    writer.i8(quantPitch(cmd.pitch));
    writer.u8(cmd.buttons & 0xff);
  }
  return writer.bytes();
}

export function decodeInputPacket(data: Uint8Array): InputCommand[] {
  const r = new ByteReader(data);
  const type = r.u8();
  if (type !== PacketType.Input) throw new Error(`expected Input packet, got ${type}`);
  const count = r.u8();
  const commands: InputCommand[] = [];
  for (let i = 0; i < count; i++) {
    commands.push({
      seq: r.u32(),
      moveX: r.i8() / 127,
      moveZ: r.i8() / 127,
      yaw: dequantYaw(r.u16()),
      pitch: dequantPitch(r.i8()),
      buttons: r.u8(),
    });
  }
  return commands;
}

// ── Snapshot packets ─────────────────────────────────────────────────────────

export function encodeSnapshot(writer: ByteWriter, snapshot: Snapshot): Uint8Array {
  writer.reset();
  writer.u8(PacketType.Snapshot);
  writer.u32(snapshot.tick);
  writer.u32(snapshot.ackSeq >>> 0); // -1 (no input yet) wraps to 0xFFFFFFFF
  writer.u8(snapshot.entities.length);
  for (const e of snapshot.entities) {
    let flags = 0;
    if (e.alive) flags |= FLAG_ALIVE;
    if (e.role === 'hunter') flags |= FLAG_HUNTER;
    if (e.locked) flags |= FLAG_LOCKED;
    writer.u8(e.netId);
    writer.u8(flags);
    writer.i16(Math.round(e.x * POS_SCALE));
    writer.i16(Math.round(e.z * POS_SCALE));
    writer.u16(quantYaw(e.yaw));
    writer.u8(e.propType);
    writer.u8(e.health);
  }
  return writer.bytes();
}

export function decodeSnapshot(data: Uint8Array): Snapshot {
  const r = new ByteReader(data);
  const type = r.u8();
  if (type !== PacketType.Snapshot) throw new Error(`expected Snapshot packet, got ${type}`);
  const tick = r.u32();
  const ackSeqRaw = r.u32();
  const ackSeq = ackSeqRaw === 0xffffffff ? -1 : ackSeqRaw;
  const count = r.u8();
  const entities: EntityRecord[] = [];
  for (let i = 0; i < count; i++) {
    const netId = r.u8();
    const flags = r.u8();
    const x = r.i16() / POS_SCALE;
    const z = r.i16() / POS_SCALE;
    const yaw = dequantYaw(r.u16());
    const propType = r.u8() as PropType;
    const health = r.u8();
    const role: Role = flags & FLAG_HUNTER ? 'hunter' : 'hider';
    entities.push({
      netId,
      x,
      z,
      yaw,
      alive: (flags & FLAG_ALIVE) !== 0,
      role,
      propType,
      locked: (flags & FLAG_LOCKED) !== 0,
      health,
    });
  }
  return { tick, ackSeq, entities };
}

export function packetType(data: Uint8Array): PacketType {
  return data[0] as PacketType;
}
