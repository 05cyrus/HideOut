import { describe, it, expect } from 'vitest';
import { stepPlayer, type MovementState } from './movement';
import { aabb, type CollisionWorld } from './physics';
import { create as vec3 } from '../core/math/vec3';
import type { InputCommand } from './types';

const world: CollisionWorld = { bounds: aabb(-50, -50, 50, 50), colliders: [] };

function cmd(partial: Partial<InputCommand>): InputCommand {
  return { seq: 0, moveX: 0, moveZ: 0, yaw: 0, pitch: 0, buttons: 0, ...partial };
}

function freshState(): MovementState {
  return { pos: vec3(), yaw: 0, pitch: 0 };
}

describe('stepPlayer', () => {
  it('moves forward along +Z at yaw 0', () => {
    const s = freshState();
    stepPlayer(s, cmd({ moveZ: 1 }), world, 0.4, 4, 0.5);
    expect(s.pos.z).toBeCloseTo(2);
    expect(s.pos.x).toBeCloseTo(0);
  });

  it('moves relative to yaw (facing +X at yaw = PI/2)', () => {
    const s = freshState();
    stepPlayer(s, cmd({ moveZ: 1, yaw: Math.PI / 2 }), world, 0.4, 4, 0.5);
    expect(s.pos.x).toBeCloseTo(2);
    expect(s.pos.z).toBeCloseTo(0);
  });

  it('clamps diagonal intent to unit magnitude (no speed hack)', () => {
    const s = freshState();
    stepPlayer(s, cmd({ moveX: 5, moveZ: 5 }), world, 0.4, 4, 1);
    // Displacement magnitude must be exactly speed * dt = 4, not 4 * sqrt(50).
    const dist = Math.hypot(s.pos.x, s.pos.z);
    expect(dist).toBeCloseTo(4);
  });

  it('applies look but no movement when frozen (speed 0)', () => {
    const s = freshState();
    stepPlayer(s, cmd({ moveZ: 1, yaw: 1, pitch: 0.5 }), world, 0.4, 0, 0.5);
    expect(s.pos.z).toBe(0);
    expect(s.yaw).toBe(1);
    expect(s.pitch).toBe(0.5);
  });

  it('clamps pitch to ±PI/2', () => {
    const s = freshState();
    stepPlayer(s, cmd({ pitch: 9 }), world, 0.4, 4, 0.1);
    expect(s.pitch).toBeCloseTo(Math.PI / 2);
  });

  it('is deterministic: same inputs → identical trajectory (prediction = host)', () => {
    const run = () => {
      const s = freshState();
      for (let i = 0; i < 60; i++) {
        stepPlayer(
          s,
          cmd({ seq: i, moveX: Math.sin(i * 0.1), moveZ: 0.8, yaw: i * 0.01 }),
          world,
          0.4,
          4.5,
          1 / 30,
        );
      }
      return s;
    };
    const a = run();
    const b = run();
    expect(a.pos).toEqual(b.pos);
    expect(a.yaw).toBe(b.yaw);
  });
});
