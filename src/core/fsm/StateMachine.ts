/**
 * Generic finite state machine.
 *
 * Drives the app-flow FSM (Splash → Menu → Lobby → …) and the round FSM
 * (Preparation → Hiding → Hunting → RoundEnd). Transitions are declarative: each state
 * maps events to target states, with optional `onEnter`/`onExit` side effects that
 * receive a shared, typed context object.
 *
 * Deliberately pure (no timers, no EventBus coupling) so it is trivially unit-testable;
 * callers wire it to the clock/bus as needed.
 */
export interface StateConfig<S extends string, E extends string, Ctx> {
  onEnter?(ctx: Ctx, from: S | null): void;
  onExit?(ctx: Ctx, to: S): void;
  transitions?: Partial<Record<E, S>>;
}

export type StatesConfig<S extends string, E extends string, Ctx> = Record<
  S,
  StateConfig<S, E, Ctx>
>;

export class StateMachine<S extends string, E extends string, Ctx = undefined> {
  private _state: S;

  constructor(
    private readonly states: StatesConfig<S, E, Ctx>,
    initial: S,
    private readonly ctx: Ctx,
  ) {
    this._state = initial;
    this.states[initial].onEnter?.(this.ctx, null);
  }

  get state(): S {
    return this._state;
  }

  is(state: S): boolean {
    return this._state === state;
  }

  /** Whether the given event has a defined transition from the current state. */
  can(event: E): boolean {
    return this.states[this._state].transitions?.[event] !== undefined;
  }

  /**
   * Fire an event. If the current state defines a transition for it, run `onExit` on the
   * old state and `onEnter` on the new state, then return true. Otherwise return false
   * (no-op). Self-transitions re-run exit/enter (treated as re-entry).
   */
  send(event: E): boolean {
    const target = this.states[this._state].transitions?.[event];
    if (target === undefined) return false;

    const from = this._state;
    this.states[from].onExit?.(this.ctx, target);
    this._state = target;
    this.states[target].onEnter?.(this.ctx, from);
    return true;
  }
}
