/**
 * The shared player movement step.
 *
 * CRITICAL: this exact function runs in three places — host simulation, client-side
 * prediction, and client-side replay after reconciliation. Any divergence between
 * those paths shows up as rubber-banding, so all movement logic lives here and
 * nowhere else.
 */
import { clamp } from '../core/math/scalar';
import type { Vec3 } from '../core/math/vec3';
import { moveCircle, type CollisionWorld } from './physics';
import type { InputCommand } from './types';

export interface MovementState {
  pos: Vec3;
  yaw: number;
  pitch: number;
}

const HALF_PI = Math.PI / 2;

/**
 * Advance one player by one input command over `dt` seconds.
 * `speed` is resolved by the caller (walk / disguised / frozen=0).
 */
export function stepPlayer(
  state: MovementState,
  input: InputCommand,
  world: CollisionWorld,
  radius: number,
  speed: number,
  dt: number,
): void {
  // Look is always applied, even when frozen — being able to look around while
  // waiting is important feedback (and harmless to authority).
  state.yaw = input.yaw;
  state.pitch = clamp(input.pitch, -HALF_PI, HALF_PI);

  if (speed <= 0) return;

  // Clamp intent to the unit disc (anti-speed-hack: host never trusts magnitude).
  let mx = clamp(input.moveX, -1, 1);
  let mz = clamp(input.moveZ, -1, 1);
  const magSq = mx * mx + mz * mz;
  if (magSq > 1) {
    const inv = 1 / Math.sqrt(magSq);
    mx *= inv;
    mz *= inv;
  }
  if (mx === 0 && mz === 0) return;

  // Move relative to yaw: forward = (sin yaw, cos yaw), right = (cos yaw, -sin yaw).
  const sin = Math.sin(state.yaw);
  const cos = Math.cos(state.yaw);
  const dx = (mz * sin + mx * cos) * speed * dt;
  const dz = (mz * cos - mx * sin) * speed * dt;

  moveCircle(state.pos, radius, dx, dz, world);
}
