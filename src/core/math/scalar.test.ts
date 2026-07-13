import { describe, it, expect } from 'vitest';
import { clamp, clamp01, lerp, inverseLerp, wrapAngle, lerpAngle, damp, TAU } from './scalar';

describe('scalar', () => {
  it('clamps within range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(99, 0, 10)).toBe(10);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(-2)).toBe(0);
  });

  it('lerp and inverseLerp are inverses', () => {
    expect(lerp(0, 100, 0.25)).toBe(25);
    expect(inverseLerp(0, 100, 25)).toBe(0.25);
    expect(inverseLerp(5, 5, 5)).toBe(0); // degenerate range
  });

  it('wraps angles into [-PI, PI]', () => {
    expect(wrapAngle(0)).toBeCloseTo(0);
    expect(wrapAngle(TAU)).toBeCloseTo(0);
    expect(wrapAngle(Math.PI + 0.1)).toBeCloseTo(-Math.PI + 0.1);
  });

  it('lerpAngle takes the shortest path across the -PI/PI seam', () => {
    // From 170° to -170° should move +20° (through 180°), not -340°.
    const a = (170 * Math.PI) / 180;
    const b = (-170 * Math.PI) / 180;
    const mid = lerpAngle(a, b, 0.5);
    expect(wrapAngle(mid)).toBeCloseTo(Math.PI); // 180°
  });

  it('damp approaches the target and is frame-rate independent-ish', () => {
    let v = 0;
    for (let i = 0; i < 100; i++) v = damp(v, 10, 8, 1 / 60);
    expect(v).toBeCloseTo(10, 3);
  });
});
