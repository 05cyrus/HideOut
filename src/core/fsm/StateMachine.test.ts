import { describe, it, expect } from 'vitest';
import { StateMachine, type StatesConfig } from './StateMachine';

type S = 'idle' | 'running' | 'paused';
type E = 'start' | 'pause' | 'resume' | 'stop';

interface Ctx {
  log: string[];
}

function build(): StateMachine<S, E, Ctx> {
  const ctx: Ctx = { log: [] };
  const states: StatesConfig<S, E, Ctx> = {
    idle: {
      onEnter: (c, from) => c.log.push(`enter:idle:${from}`),
      transitions: { start: 'running' },
    },
    running: {
      onEnter: (c) => c.log.push('enter:running'),
      onExit: (c, to) => c.log.push(`exit:running:${to}`),
      transitions: { pause: 'paused', stop: 'idle' },
    },
    paused: {
      transitions: { resume: 'running', stop: 'idle' },
    },
  };
  return new StateMachine(states, 'idle', ctx);
}

describe('StateMachine', () => {
  it('runs onEnter for the initial state', () => {
    const ctx: Ctx = { log: [] };
    const states: StatesConfig<S, E, Ctx> = {
      idle: { onEnter: (c, from) => c.log.push(`enter:idle:${from}`) },
      running: {},
      paused: {},
    };
    new StateMachine(states, 'idle', ctx);
    expect(ctx.log).toEqual(['enter:idle:null']);
  });

  it('transitions on defined events and fires exit/enter hooks', () => {
    const fsm = build();
    expect(fsm.state).toBe('idle');
    expect(fsm.send('start')).toBe(true);
    expect(fsm.state).toBe('running');
    expect(fsm.send('pause')).toBe(true);
    expect(fsm.state).toBe('paused');
  });

  it('ignores undefined transitions (no-op, returns false)', () => {
    const fsm = build();
    expect(fsm.can('pause')).toBe(false); // idle has no "pause"
    expect(fsm.send('pause')).toBe(false);
    expect(fsm.state).toBe('idle');
  });

  it('reports valid transitions via can()', () => {
    const fsm = build();
    expect(fsm.can('start')).toBe(true);
    fsm.send('start');
    expect(fsm.can('stop')).toBe(true);
    expect(fsm.can('start')).toBe(false);
  });
});
