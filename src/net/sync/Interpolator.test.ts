import { describe, it, expect } from 'vitest';
import { Interpolator } from './Interpolator';

describe('Interpolator', () => {
  it('lerps between bracketing samples', () => {
    const interp = new Interpolator();
    interp.push({ tick: 10, x: 0, z: 0, yaw: 0 });
    interp.push({ tick: 20, x: 10, z: -10, yaw: 1 });
    const mid = interp.sample(15)!;
    expect(mid.x).toBeCloseTo(5);
    expect(mid.z).toBeCloseTo(-5);
    expect(mid.yaw).toBeCloseTo(0.5);
  });

  it('clamps to the buffered range (holds last state when dry)', () => {
    const interp = new Interpolator();
    interp.push({ tick: 10, x: 1, z: 2, yaw: 0.3 });
    expect(interp.sample(5)!.x).toBe(1); // before first
    expect(interp.sample(50)!.x).toBe(1); // after last: hold, no extrapolation
    expect(new Interpolator().sample(1)).toBeNull();
  });

  it('ignores stale/duplicate ticks from the unordered channel', () => {
    const interp = new Interpolator();
    interp.push({ tick: 10, x: 0, z: 0, yaw: 0 });
    interp.push({ tick: 12, x: 2, z: 0, yaw: 0 });
    interp.push({ tick: 11, x: 99, z: 99, yaw: 0 }); // late arrival — dropped
    expect(interp.sample(11)!.x).toBeCloseTo(1); // interpolated 10→12, not 99
    expect(interp.latestTick).toBe(12);
  });

  it('interpolates yaw across the -PI/PI seam via shortest path', () => {
    const interp = new Interpolator();
    const a = Math.PI - 0.1;
    const b = -Math.PI + 0.1;
    interp.push({ tick: 0, x: 0, z: 0, yaw: a });
    interp.push({ tick: 10, x: 0, z: 0, yaw: b });
    const mid = interp.sample(5)!;
    // Shortest path crosses PI, so |mid.yaw| ≈ PI (not 0).
    expect(Math.abs(Math.abs(mid.yaw) - Math.PI)).toBeLessThan(0.01);
  });

  it('bounds memory (drops oldest beyond capacity)', () => {
    const interp = new Interpolator();
    for (let i = 0; i < 100; i++) interp.push({ tick: i, x: i, z: 0, yaw: 0 });
    expect(interp.sample(0)!.x).toBeGreaterThan(0); // oldest dropped
    expect(interp.latestTick).toBe(99);
  });
});
