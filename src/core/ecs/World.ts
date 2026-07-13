/**
 * Entity-Component-System world.
 *
 * Design: entities are 32-bit integer handles packed as `(generation << 20) | index`.
 * The generation guards against stale handles — after an entity is destroyed and its
 * index recycled, an old handle no longer matches and `isAlive` returns false.
 *
 * Components live in per-type sparse-set stores (`Map<Entity, T>`). This keeps the API
 * simple and cache-friendly enough for our scale (8–12 players + hundreds of static
 * props, most of which never change), and can be swapped for archetype/struct-of-arrays
 * storage later without touching the public interface. Queries iterate the smallest
 * matching store to stay cheap.
 */

export type Entity = number;

const INDEX_BITS = 20;
const INDEX_MASK = (1 << INDEX_BITS) - 1; // up to 1,048,576 concurrent entities
const GENERATION_MASK = 0xfff; // 12 bits of generation

function packEntity(index: number, generation: number): Entity {
  return (((generation & GENERATION_MASK) << INDEX_BITS) | index) >>> 0;
}

function entityIndex(entity: Entity): number {
  return entity & INDEX_MASK;
}

/** A component type is an opaque identity plus a factory for its default data. */
export interface ComponentType<T> {
  readonly name: string;
  create(init?: Partial<T>): T;
}

/**
 * Define a component type. `defaults` produces a fresh instance; `init` (when adding)
 * overrides individual fields.
 *
 * Note: `create` is declared as a method so `ComponentType<T>` remains assignable to
 * `ComponentType<unknown>` (TypeScript checks method parameters bivariantly), which lets
 * `query(...)` accept heterogeneous component types without `any`.
 */
export function defineComponent<T>(name: string, defaults: () => T): ComponentType<T> {
  return {
    name,
    create(init?: Partial<T>): T {
      const base = defaults();
      // `T` is intentionally unconstrained (components may be any shape), so assign via a
      // widened target rather than constraining `T extends object` — that constraint would
      // break `query(...: ComponentType<unknown>)`.
      if (init) Object.assign(base as unknown as object, init);
      return base;
    },
  };
}

export interface System {
  readonly name: string;
  update(world: World, dt: number): void;
}

export class World {
  private readonly generations: number[] = [];
  private readonly freeIndices: number[] = [];
  private nextIndex = 0;
  private readonly aliveEntities = new Set<Entity>();
  private readonly stores = new Map<ComponentType<unknown>, Map<Entity, unknown>>();
  private readonly systems: System[] = [];

  createEntity(): Entity {
    let index: number;
    const recycled = this.freeIndices.pop();
    if (recycled !== undefined) {
      index = recycled;
    } else {
      index = this.nextIndex++;
      this.generations[index] = 0;
    }
    const entity = packEntity(index, this.generations[index] ?? 0);
    this.aliveEntities.add(entity);
    return entity;
  }

  destroyEntity(entity: Entity): boolean {
    if (!this.aliveEntities.has(entity)) return false;
    this.aliveEntities.delete(entity);
    for (const store of this.stores.values()) {
      store.delete(entity);
    }
    const index = entityIndex(entity);
    this.generations[index] = ((this.generations[index] ?? 0) + 1) & GENERATION_MASK;
    this.freeIndices.push(index);
    return true;
  }

  isAlive(entity: Entity): boolean {
    return this.aliveEntities.has(entity);
  }

  get entityCount(): number {
    return this.aliveEntities.size;
  }

  add<T>(entity: Entity, type: ComponentType<T>, init?: Partial<T>): T {
    if (!this.aliveEntities.has(entity)) {
      throw new Error(`Cannot add component "${type.name}" to a dead entity`);
    }
    const component = type.create(init);
    this.store(type).set(entity, component);
    return component;
  }

  get<T>(entity: Entity, type: ComponentType<T>): T | undefined {
    return this.store(type).get(entity);
  }

  getOrThrow<T>(entity: Entity, type: ComponentType<T>): T {
    const component = this.store(type).get(entity);
    if (component === undefined) {
      throw new Error(`Entity is missing required component "${type.name}"`);
    }
    return component;
  }

  has<T>(entity: Entity, type: ComponentType<T>): boolean {
    return this.store(type).has(entity);
  }

  remove<T>(entity: Entity, type: ComponentType<T>): boolean {
    return this.store(type).delete(entity);
  }

  /**
   * Return all live entities that have every listed component. With no arguments,
   * returns all live entities. Iterates the smallest store for efficiency.
   */
  query(...types: ComponentType<unknown>[]): Entity[] {
    if (types.length === 0) {
      return Array.from(this.aliveEntities);
    }

    let smallest: Map<Entity, unknown> | undefined;
    for (const type of types) {
      const store = this.stores.get(type);
      if (!store) return []; // no entity has this component
      if (!smallest || store.size < smallest.size) smallest = store;
    }

    const result: Entity[] = [];
    outer: for (const entity of smallest!.keys()) {
      for (const type of types) {
        if (!this.stores.get(type)!.has(entity)) continue outer;
      }
      result.push(entity);
    }
    return result;
  }

  addSystem(system: System): this {
    this.systems.push(system);
    return this;
  }

  /** Run every registered system in registration order. */
  update(dt: number): void {
    for (const system of this.systems) {
      system.update(this, dt);
    }
  }

  clear(): void {
    this.aliveEntities.clear();
    this.stores.clear();
    this.freeIndices.length = 0;
    this.generations.length = 0;
    this.nextIndex = 0;
  }

  private store<T>(type: ComponentType<T>): Map<Entity, T> {
    let store = this.stores.get(type) as Map<Entity, T> | undefined;
    if (!store) {
      store = new Map<Entity, T>();
      this.stores.set(type, store as Map<Entity, unknown>);
    }
    return store;
  }
}
