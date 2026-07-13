import { describe, it, expect, vi } from 'vitest';
import { Container, token } from './Container';

interface Logger {
  log(msg: string): void;
}
interface Service {
  readonly logger: Logger;
}

const LoggerToken = token<Logger>('Logger');
const ServiceToken = token<Service>('Service');

describe('Container', () => {
  it('resolves registered values', () => {
    const c = new Container();
    const logger: Logger = { log: () => {} };
    c.registerValue(LoggerToken, logger);
    expect(c.resolve(LoggerToken)).toBe(logger);
    expect(c.has(LoggerToken)).toBe(true);
  });

  it('caches singletons (factory runs once)', () => {
    const c = new Container();
    const factory = vi.fn((): Logger => ({ log: () => {} }));
    c.register(LoggerToken, factory);
    const a = c.resolve(LoggerToken);
    const b = c.resolve(LoggerToken);
    expect(a).toBe(b);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('creates a fresh instance for transient registrations', () => {
    const c = new Container();
    c.register(LoggerToken, (): Logger => ({ log: () => {} }), { singleton: false });
    expect(c.resolve(LoggerToken)).not.toBe(c.resolve(LoggerToken));
  });

  it('injects dependencies via the container', () => {
    const c = new Container();
    const logger: Logger = { log: () => {} };
    c.registerValue(LoggerToken, logger);
    c.register(ServiceToken, (container) => ({ logger: container.resolve(LoggerToken) }));
    expect(c.resolve(ServiceToken).logger).toBe(logger);
  });

  it('throws on missing providers', () => {
    const c = new Container();
    expect(() => c.resolve(LoggerToken)).toThrow(/No provider/);
  });

  it('detects circular dependencies', () => {
    const c = new Container();
    const A = token<{ b: unknown }>('A');
    const B = token<{ a: unknown }>('B');
    c.register(A, (container) => ({ b: container.resolve(B) }));
    c.register(B, (container) => ({ a: container.resolve(A) }));
    expect(() => c.resolve(A)).toThrow(/Circular dependency/);
  });
});
