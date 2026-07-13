/**
 * Minimal dependency-injection container.
 *
 * Chosen over decorator-based libraries (tsyringe, inversify) to avoid a
 * `reflect-metadata` runtime cost on low-end devices. Services are keyed by typed
 * `Token`s; factories receive the container so they can resolve their own dependencies.
 * Singletons are cached; a resolving-stack guard turns circular dependencies into a
 * clear error instead of a stack overflow.
 */
export interface Token<T> {
  readonly key: symbol;
  readonly name: string;
  /** Phantom field to carry `T` for inference; never read at runtime. */
  readonly _type?: T;
}

export function token<T>(name: string): Token<T> {
  return { key: Symbol(name), name };
}

export type Factory<T> = (container: Container) => T;

interface Registration {
  factory: Factory<unknown>;
  singleton: boolean;
}

export class Container {
  private readonly registrations = new Map<symbol, Registration>();
  private readonly instances = new Map<symbol, unknown>();
  private readonly resolving = new Set<symbol>();

  /** Register a pre-built value (always treated as a singleton). */
  registerValue<T>(t: Token<T>, value: T): this {
    this.instances.set(t.key, value);
    return this;
  }

  /** Register a factory. Singleton by default; pass `{ singleton: false }` for transient. */
  register<T>(t: Token<T>, factory: Factory<T>, options?: { singleton?: boolean }): this {
    this.registrations.set(t.key, {
      factory: factory as Factory<unknown>,
      singleton: options?.singleton ?? true,
    });
    return this;
  }

  has<T>(t: Token<T>): boolean {
    return this.instances.has(t.key) || this.registrations.has(t.key);
  }

  resolve<T>(t: Token<T>): T {
    if (this.instances.has(t.key)) {
      return this.instances.get(t.key) as T;
    }

    const registration = this.registrations.get(t.key);
    if (!registration) {
      throw new Error(`No provider registered for token "${t.name}"`);
    }

    if (this.resolving.has(t.key)) {
      throw new Error(`Circular dependency detected while resolving "${t.name}"`);
    }

    this.resolving.add(t.key);
    try {
      const value = registration.factory(this) as T;
      if (registration.singleton) {
        this.instances.set(t.key, value);
      }
      return value;
    } finally {
      this.resolving.delete(t.key);
    }
  }
}
