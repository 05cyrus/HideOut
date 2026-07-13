/**
 * Snapshot interpolation buffer for ONE remote entity.
 *
 * Clients render remote players slightly in the past (interpDelayTicks) and
 * lerp between the two snapshots bracketing the render time — the standard
 * technique that turns 30 Hz snapshots into smooth motion. If the buffer runs
 * dry (loss burst), we hold the last known state rather than extrapolating
 * into walls; the next snapshot snaps us back on course.
 */
import { lerp, lerpAngle } from '../../core/math/scalar';

export interface InterpSample {
  tick: number;
  x: number;
  z: number;
  yaw: number;
}

const MAX_SAMPLES = 32;

export class Interpolator {
  private samples: InterpSample[] = [];

  push(sample: InterpSample): void {
    const last = this.samples[this.samples.length - 1];
    if (last && sample.tick <= last.tick) return; // stale/duplicate (unordered channel)
    this.samples.push(sample);
    if (this.samples.length > MAX_SAMPLES) this.samples.shift();
  }

  get latestTick(): number {
    return this.samples.length ? this.samples[this.samples.length - 1]!.tick : -1;
  }

  get empty(): boolean {
    return this.samples.length === 0;
  }

  /** Interpolated state at a (fractional) tick, clamped to the buffered range. */
  sample(atTick: number): { x: number; z: number; yaw: number } | null {
    const n = this.samples.length;
    if (n === 0) return null;

    const first = this.samples[0]!;
    const last = this.samples[n - 1]!;
    if (atTick <= first.tick) return { x: first.x, z: first.z, yaw: first.yaw };
    if (atTick >= last.tick) return { x: last.x, z: last.z, yaw: last.yaw };

    // Find the bracketing pair (buffer is small; linear scan is cache-friendly).
    for (let i = n - 2; i >= 0; i--) {
      const a = this.samples[i]!;
      if (a.tick <= atTick) {
        const b = this.samples[i + 1]!;
        const t = (atTick - a.tick) / (b.tick - a.tick);
        return {
          x: lerp(a.x, b.x, t),
          z: lerp(a.z, b.z, t),
          yaw: lerpAngle(a.yaw, b.yaw, t),
        };
      }
    }
    return { x: last.x, z: last.z, yaw: last.yaw };
  }

  clear(): void {
    this.samples.length = 0;
  }
}
