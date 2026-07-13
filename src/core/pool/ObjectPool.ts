/**
 * Object pool for GC discipline.
 *
 * Hot paths (network packets, transient vectors, particle/entity scratch) allocate and
 * discard many short-lived objects per frame, which causes GC pauses — the enemy of a
 * steady 60fps on low-end Android. Pools recycle instances instead.
 *
 * `reset` is called on release so objects return to the pool in a clean state.
 * `maxSize` caps retained instances so a burst of releases can't grow memory unbounded.
 */
export interface ObjectPoolOptions<T> {
  factory: () => T;
  reset?: (item: T) => void;
  /** Pre-allocate this many instances up front. Default 0. */
  initialSize?: number;
  /** Maximum instances retained in the free list. Default Infinity. */
  maxSize?: number;
}

export class ObjectPool<T> {
  private readonly free: T[] = [];
  private readonly factory: () => T;
  private readonly reset?: (item: T) => void;
  private readonly maxSize: number;
  private _created = 0;

  constructor(options: ObjectPoolOptions<T>) {
    this.factory = options.factory;
    this.reset = options.reset;
    this.maxSize = options.maxSize ?? Number.POSITIVE_INFINITY;

    const initialSize = options.initialSize ?? 0;
    for (let i = 0; i < initialSize; i++) {
      this.free.push(this.make());
    }
  }

  acquire(): T {
    const pooled = this.free.pop();
    return pooled ?? this.make();
  }

  release(item: T): void {
    this.reset?.(item);
    if (this.free.length < this.maxSize) {
      this.free.push(item);
    }
  }

  /** Instances currently available for reuse. */
  get available(): number {
    return this.free.length;
  }

  /** Total instances ever created by the factory (pool churn metric). */
  get created(): number {
    return this._created;
  }

  private make(): T {
    this._created++;
    return this.factory();
  }
}
