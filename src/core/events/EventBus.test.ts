import { describe, it, expect, vi } from 'vitest';
import { EventBus } from './EventBus';

type BusEvents = {
  count: number;
  msg: string;
};

describe('EventBus', () => {
  it('delivers typed payloads to subscribers', () => {
    const bus = new EventBus<BusEvents>();
    const handler = vi.fn<(n: number) => void>();
    bus.on('count', handler);
    bus.emit('count', 42);
    expect(handler).toHaveBeenCalledWith(42);
  });

  it('unsubscribe stops delivery', () => {
    const bus = new EventBus<BusEvents>();
    const handler = vi.fn();
    const off = bus.on('count', handler);
    off();
    bus.emit('count', 1);
    expect(handler).not.toHaveBeenCalled();
    expect(bus.listenerCount('count')).toBe(0);
  });

  it('once fires exactly one time', () => {
    const bus = new EventBus<BusEvents>();
    const handler = vi.fn();
    bus.once('count', handler);
    bus.emit('count', 1);
    bus.emit('count', 2);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(1);
  });

  it('is safe against subscribe/unsubscribe during dispatch', () => {
    const bus = new EventBus<BusEvents>();
    const late = vi.fn();
    bus.on('count', () => {
      // Subscribing mid-dispatch must not affect the in-flight emit.
      bus.on('count', late);
    });
    bus.emit('count', 1);
    expect(late).not.toHaveBeenCalled();
    bus.emit('count', 2);
    expect(late).toHaveBeenCalledTimes(1);
  });

  it('clear removes handlers for one type or all', () => {
    const bus = new EventBus<BusEvents>();
    bus.on('count', vi.fn());
    bus.on('msg', vi.fn());
    bus.clear('count');
    expect(bus.listenerCount('count')).toBe(0);
    expect(bus.listenerCount('msg')).toBe(1);
    bus.clear();
    expect(bus.listenerCount('msg')).toBe(0);
  });
});
