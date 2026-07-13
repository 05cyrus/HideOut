import { describe, it, expect } from 'vitest';
import { ByteWriter } from './bytes';
import { decodeInputPacket, decodeSnapshot, encodeInputPacket, encodeSnapshot } from './packets';
import { PropType } from '../../game/types';
import type { EntityRecord, InputCommand } from '../../game/types';

describe('input packet codec', () => {
  it('round-trips commands within quantization error', () => {
    const writer = new ByteWriter();
    const commands: InputCommand[] = [
      { seq: 0, moveX: 0.5, moveZ: -1, yaw: 1.234, pitch: -0.4, buttons: 0b1010 },
      { seq: 1, moveX: -0.25, moveZ: 0.75, yaw: -3.0, pitch: 1.2, buttons: 0 },
      { seq: 70000, moveX: 0, moveZ: 0, yaw: 0, pitch: 0, buttons: 255 },
    ];
    const decoded = decodeInputPacket(encodeInputPacket(writer, commands));

    expect(decoded).toHaveLength(3);
    decoded.forEach((cmd, i) => {
      const src = commands[i]!;
      expect(cmd.seq).toBe(src.seq);
      expect(cmd.buttons).toBe(src.buttons);
      expect(cmd.moveX).toBeCloseTo(src.moveX, 1);
      expect(cmd.moveZ).toBeCloseTo(src.moveZ, 1);
      expect(cmd.yaw).toBeCloseTo(src.yaw, 2);
      expect(cmd.pitch).toBeCloseTo(src.pitch, 1);
    });
  });

  it('is compact: 3 redundant commands fit in ~32 bytes', () => {
    const writer = new ByteWriter();
    const cmd: InputCommand = { seq: 1, moveX: 1, moveZ: 1, yaw: 0, pitch: 0, buttons: 0 };
    const packet = encodeInputPacket(writer, [cmd, cmd, cmd]);
    expect(packet.length).toBeLessThanOrEqual(32);
  });
});

describe('snapshot codec', () => {
  const entities: EntityRecord[] = [
    {
      netId: 0,
      x: -17.53,
      z: 11.98,
      yaw: -Math.PI + 0.01,
      alive: true,
      role: 'hunter',
      propType: PropType.None,
      locked: false,
      health: 76,
    },
    {
      netId: 5,
      x: 3.125,
      z: -0.5,
      yaw: 2.5,
      alive: false,
      role: 'hider',
      propType: PropType.Barrel,
      locked: true,
      health: 255,
    },
  ];

  it('round-trips entities within quantization error', () => {
    const writer = new ByteWriter();
    const decoded = decodeSnapshot(encodeSnapshot(writer, { tick: 12345, ackSeq: 678, entities }));
    expect(decoded.tick).toBe(12345);
    expect(decoded.ackSeq).toBe(678);
    expect(decoded.entities).toHaveLength(2);

    const [a, b] = decoded.entities;
    expect(a!.netId).toBe(0);
    expect(a!.x).toBeCloseTo(-17.53, 2);
    expect(a!.z).toBeCloseTo(11.98, 2);
    expect(a!.yaw).toBeCloseTo(-Math.PI + 0.01, 2);
    expect(a!.alive).toBe(true);
    expect(a!.role).toBe('hunter');
    expect(a!.health).toBe(76);

    expect(b!.propType).toBe(PropType.Barrel);
    expect(b!.locked).toBe(true);
    expect(b!.alive).toBe(false);
    expect(b!.role).toBe('hider');
  });

  it('preserves ackSeq = -1 (no input processed yet)', () => {
    const writer = new ByteWriter();
    const decoded = decodeSnapshot(encodeSnapshot(writer, { tick: 1, ackSeq: -1, entities: [] }));
    expect(decoded.ackSeq).toBe(-1);
  });

  it('is bandwidth-efficient: 12 players ≈ 130 bytes', () => {
    const writer = new ByteWriter();
    const twelve = Array.from({ length: 12 }, (_, i) => ({ ...entities[0]!, netId: i }));
    const packet = encodeSnapshot(writer, { tick: 1, ackSeq: 0, entities: twelve });
    expect(packet.length).toBeLessThanOrEqual(140);
  });
});
