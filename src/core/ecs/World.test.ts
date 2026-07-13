import { describe, it, expect } from 'vitest';
import { World, defineComponent, type System } from './World';

interface Pos {
  x: number;
  y: number;
}
interface Vel {
  dx: number;
  dy: number;
}

const Position = defineComponent<Pos>('Position', () => ({ x: 0, y: 0 }));
const Velocity = defineComponent<Vel>('Velocity', () => ({ dx: 0, dy: 0 }));

describe('World — entities', () => {
  it('creates, tracks, and destroys entities', () => {
    const w = new World();
    const e = w.createEntity();
    expect(w.isAlive(e)).toBe(true);
    expect(w.entityCount).toBe(1);
    expect(w.destroyEntity(e)).toBe(true);
    expect(w.isAlive(e)).toBe(false);
    expect(w.destroyEntity(e)).toBe(false); // already dead
  });

  it('recycles indices with a new generation so stale handles are detected', () => {
    const w = new World();
    const e1 = w.createEntity();
    w.destroyEntity(e1);
    const e2 = w.createEntity(); // reuses the freed index
    expect(e2).not.toBe(e1);
    expect(w.isAlive(e1)).toBe(false);
    expect(w.isAlive(e2)).toBe(true);
  });
});

describe('World — components', () => {
  it('adds, reads, checks, and removes components', () => {
    const w = new World();
    const e = w.createEntity();
    const pos = w.add(e, Position, { x: 3 });
    expect(pos).toEqual({ x: 3, y: 0 });
    expect(w.get(e, Position)).toBe(pos);
    expect(w.has(e, Position)).toBe(true);
    expect(w.has(e, Velocity)).toBe(false);
    expect(w.remove(e, Position)).toBe(true);
    expect(w.get(e, Position)).toBeUndefined();
  });

  it('destroying an entity clears its components', () => {
    const w = new World();
    const e = w.createEntity();
    w.add(e, Position);
    w.destroyEntity(e);
    expect(w.get(e, Position)).toBeUndefined();
  });

  it('throws when adding to a dead entity', () => {
    const w = new World();
    const e = w.createEntity();
    w.destroyEntity(e);
    expect(() => w.add(e, Position)).toThrow();
  });

  it('getOrThrow throws on a missing component', () => {
    const w = new World();
    const e = w.createEntity();
    expect(() => w.getOrThrow(e, Position)).toThrow(/missing required component/);
  });
});

describe('World — queries', () => {
  it('returns only entities with all requested components', () => {
    const w = new World();
    const a = w.createEntity();
    const b = w.createEntity();
    const c = w.createEntity();
    w.add(a, Position);
    w.add(b, Position);
    w.add(c, Position);
    w.add(b, Velocity); // only b has both

    expect(w.query(Position).sort()).toEqual([a, b, c].sort());
    expect(w.query(Position, Velocity)).toEqual([b]);
    expect(w.query()).toHaveLength(3);
  });
});

describe('World — systems', () => {
  it('runs systems in registration order with the frame dt', () => {
    const w = new World();
    const order: string[] = [];
    let seenDt = 0;
    const sysA: System = {
      name: 'A',
      update: (_world, dt) => {
        order.push('A');
        seenDt = dt;
      },
    };
    const sysB: System = { name: 'B', update: () => void order.push('B') };
    w.addSystem(sysA).addSystem(sysB);
    w.update(0.016);
    expect(order).toEqual(['A', 'B']);
    expect(seenDt).toBe(0.016);
  });
});
