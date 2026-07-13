import { describe, it, expect } from 'vitest';
import {
  aabb,
  circleIntersectsAABB,
  moveCircle,
  rayCircle,
  rayAABB,
  raycastWalls,
} from './physics';
import { create as vec3 } from '../core/math/vec3';
import type { CollisionWorld } from './physics';

const world: CollisionWorld = {
  bounds: aabb(-10, -10, 10, 10),
  colliders: [aabb(-1, -1, 1, 1)], // 2x2 pillar at the origin
};

describe('circleIntersectsAABB', () => {
  it('detects overlap and separation', () => {
    expect(circleIntersectsAABB(0, 0, 0.5, aabb(-1, -1, 1, 1))).toBe(true); // inside
    expect(circleIntersectsAABB(1.4, 0, 0.5, aabb(-1, -1, 1, 1))).toBe(true); // edge overlap
    expect(circleIntersectsAABB(2, 2, 0.5, aabb(-1, -1, 1, 1))).toBe(false); // corner clear
  });
});

describe('moveCircle', () => {
  it('moves freely in open space', () => {
    const pos = vec3(5, 0, 5);
    moveCircle(pos, 0.4, 1, -1, world);
    expect(pos.x).toBeCloseTo(6);
    expect(pos.z).toBeCloseTo(4);
  });

  it('blocks on a wall and slides along it', () => {
    // Moving diagonally into the pillar's left face: X blocked, Z slides.
    const pos = vec3(-2, 0, 0);
    moveCircle(pos, 0.4, 1.0, 0.5, world);
    expect(pos.x).toBeCloseTo(-1.4); // pushed out to face minus radius
    expect(pos.z).toBeCloseTo(0.5); // slide unhindered
  });

  it('clamps to bounds', () => {
    const pos = vec3(9.8, 0, 0);
    moveCircle(pos, 0.4, 5, 0, world);
    expect(pos.x).toBeCloseTo(10 - 0.4);
  });
});

describe('rayCircle', () => {
  it('hits a circle ahead and returns the entry distance', () => {
    const t = rayCircle(0, -5, 0, 1, 0, 0, 1);
    expect(t).toBeCloseTo(4); // 5 to center minus radius 1
  });

  it('misses when pointing away or offset beyond the radius', () => {
    expect(rayCircle(0, -5, 0, -1, 0, 0, 1)).toBeNull(); // behind
    expect(rayCircle(2, -5, 0, 1, 0, 0, 1)).toBeNull(); // parallel, 2m off axis
  });
});

describe('rayAABB', () => {
  it('hits a box ahead', () => {
    const t = rayAABB(0, -5, 0, 1, aabb(-1, -1, 1, 1));
    expect(t).toBeCloseTo(4);
  });

  it('misses a box off axis and behind', () => {
    expect(rayAABB(5, -5, 0, 1, aabb(-1, -1, 1, 1))).toBeNull();
    expect(rayAABB(0, 5, 0, 1, aabb(-1, -1, 1, 1))).toBeNull();
  });

  it('handles axis-parallel rays (zero direction component)', () => {
    expect(rayAABB(0, -5, 0, 1, aabb(-1, -1, 1, 1))).not.toBeNull();
    expect(rayAABB(3, -5, 0, 1, aabb(-1, -1, 1, 1))).toBeNull();
  });
});

describe('raycastWalls', () => {
  it('returns nearest wall distance or Infinity', () => {
    expect(raycastWalls(0, -5, 0, 1, world)).toBeCloseTo(4);
    expect(raycastWalls(5, 5, 0, 1, world)).toBe(Infinity);
  });
});
