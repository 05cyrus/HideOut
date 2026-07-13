import { describe, it, expect } from 'vitest';
import { FixedTimestep } from './FixedTimestep';

describe('FixedTimestep', () => {
  it('accumulates time and yields whole steps, carrying the remainder', () => {
    const ts = new FixedTimestep({ step: 0.1 });
    expect(ts.advance(0.25)).toBe(2); // 0.1 + 0.1, remainder 0.05
    expect(ts.accumulated).toBeCloseTo(0.05);
    expect(ts.alpha).toBeCloseTo(0.5);

    expect(ts.advance(0.06)).toBe(1); // 0.05 + 0.06 = 0.11 -> one step
    expect(ts.accumulated).toBeCloseTo(0.01);
  });

  it('ignores non-positive deltas', () => {
    const ts = new FixedTimestep({ step: 0.1 });
    expect(ts.advance(-1)).toBe(0);
    expect(ts.advance(0)).toBe(0);
    expect(ts.accumulated).toBe(0);
  });

  it('caps catch-up and drops the backlog (spiral-of-death guard)', () => {
    const ts = new FixedTimestep({ step: 0.1, maxSteps: 3 });
    expect(ts.advance(10)).toBe(3); // would be 100 steps; capped at 3
    expect(ts.accumulated).toBe(0); // leftover discarded
  });

  it('validates constructor arguments', () => {
    expect(() => new FixedTimestep({ step: 0 })).toThrow();
    expect(() => new FixedTimestep({ maxSteps: 0 })).toThrow();
  });

  it('resets accumulated time', () => {
    const ts = new FixedTimestep({ step: 0.1 });
    ts.advance(0.05);
    ts.reset();
    expect(ts.accumulated).toBe(0);
  });
});
