import { describe, it, expect } from 'vitest';
import * as vec3 from './vec3';

describe('vec3', () => {
  it('adds and subtracts into an out target', () => {
    const out = vec3.create();
    vec3.add(out, vec3.create(1, 2, 3), vec3.create(4, 5, 6));
    expect(out).toEqual({ x: 5, y: 7, z: 9 });
    vec3.sub(out, vec3.create(4, 5, 6), vec3.create(1, 2, 3));
    expect(out).toEqual({ x: 3, y: 3, z: 3 });
  });

  it('addScaled performs a fused multiply-add (integration step)', () => {
    const pos = vec3.create(0, 0, 0);
    const vel = vec3.create(2, 0, -1);
    vec3.addScaled(pos, pos, vel, 0.5);
    expect(pos).toEqual({ x: 1, y: 0, z: -0.5 });
  });

  it('computes length and distance', () => {
    expect(vec3.length(vec3.create(3, 4, 0))).toBe(5);
    expect(vec3.distance(vec3.create(0, 0, 0), vec3.create(0, 0, 5))).toBe(5);
    expect(vec3.distanceSq(vec3.create(0, 0, 0), vec3.create(3, 4, 0))).toBe(25);
  });

  it('normalizes, and returns zero for a zero vector', () => {
    const out = vec3.create();
    vec3.normalize(out, vec3.create(0, 10, 0));
    expect(out).toEqual({ x: 0, y: 1, z: 0 });
    vec3.normalize(out, vec3.create(0, 0, 0));
    expect(out).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('lerps and compares with epsilon', () => {
    const out = vec3.create();
    vec3.lerp(out, vec3.create(0, 0, 0), vec3.create(10, 20, 30), 0.5);
    expect(vec3.equals(out, vec3.create(5, 10, 15))).toBe(true);
    expect(vec3.equals(out, vec3.create(5, 10, 16))).toBe(false);
  });
});
