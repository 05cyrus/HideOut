import { describe, it, expect } from 'vitest';
import { ObjectPool } from './ObjectPool';

interface Packet {
  seq: number;
  payload: number[];
}

function makePool(initialSize = 0, maxSize?: number) {
  return new ObjectPool<Packet>({
    factory: () => ({ seq: 0, payload: [] }),
    reset: (p) => {
      p.seq = 0;
      p.payload.length = 0;
    },
    initialSize,
    ...(maxSize !== undefined ? { maxSize } : {}),
  });
}

describe('ObjectPool', () => {
  it('pre-allocates initialSize instances', () => {
    const pool = makePool(4);
    expect(pool.available).toBe(4);
    expect(pool.created).toBe(4);
  });

  it('acquire reuses free instances before creating new ones', () => {
    const pool = makePool(1);
    const a = pool.acquire();
    expect(pool.available).toBe(0);
    expect(pool.created).toBe(1); // reused, not created
    const b = pool.acquire();
    expect(pool.created).toBe(2); // pool empty -> created
    expect(a).not.toBe(b);
  });

  it('release resets and returns instances to the pool', () => {
    const pool = makePool(0);
    const p = pool.acquire();
    p.seq = 99;
    p.payload.push(1, 2, 3);
    pool.release(p);
    expect(pool.available).toBe(1);
    const again = pool.acquire();
    expect(again).toBe(p); // same instance recycled
    expect(again.seq).toBe(0); // reset ran
    expect(again.payload).toEqual([]);
  });

  it('respects maxSize when retaining released instances', () => {
    const pool = makePool(0, 1);
    pool.release(pool.acquire());
    pool.release(pool.acquire());
    expect(pool.available).toBe(1); // second release dropped
  });
});
