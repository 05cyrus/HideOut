/**
 * Fixed-timestep accumulator — the deterministic heartbeat of the simulation.
 *
 * A variable-rate render loop (requestAnimationFrame) feeds real frame deltas into
 * `advance(dt)`, which returns how many fixed simulation steps to run this frame. This
 * decouples sim rate from frame rate so physics/netcode stay deterministic and identical
 * on every device — essential for host-authoritative play and reconciliation.
 *
 * Includes a "spiral of death" guard: if the app stalls (tab backgrounded, GC pause), we
 * cap the catch-up at `maxSteps` and drop the leftover time instead of trying to simulate
 * hundreds of steps at once.
 */
export interface FixedTimestepOptions {
  /** Seconds per simulation step. Default 1/30 (30 Hz). */
  step?: number;
  /** Maximum steps to run in a single `advance` call. Default 5. */
  maxSteps?: number;
}

export class FixedTimestep {
  readonly step: number;
  readonly maxSteps: number;
  private _accumulator = 0;

  constructor(options: FixedTimestepOptions = {}) {
    const step = options.step ?? 1 / 30;
    const maxSteps = options.maxSteps ?? 5;
    if (step <= 0) throw new Error('FixedTimestep: step must be > 0');
    if (maxSteps < 1) throw new Error('FixedTimestep: maxSteps must be >= 1');
    this.step = step;
    this.maxSteps = maxSteps;
  }

  /**
   * Feed the elapsed real time (seconds) since the last frame.
   * Returns the number of fixed steps to simulate now.
   */
  advance(deltaSeconds: number): number {
    if (deltaSeconds > 0) {
      this._accumulator += deltaSeconds;
    }

    let steps = 0;
    while (this._accumulator >= this.step && steps < this.maxSteps) {
      this._accumulator -= this.step;
      steps++;
    }

    // Fell behind past the cap: discard the backlog to avoid a catch-up spiral.
    if (steps === this.maxSteps && this._accumulator >= this.step) {
      this._accumulator = 0;
    }

    return steps;
  }

  /**
   * Interpolation factor in [0, 1) representing progress toward the next step.
   * Renderers use this to smoothly blend between the previous and current sim state.
   */
  get alpha(): number {
    return this._accumulator / this.step;
  }

  get accumulated(): number {
    return this._accumulator;
  }

  reset(): void {
    this._accumulator = 0;
  }
}
