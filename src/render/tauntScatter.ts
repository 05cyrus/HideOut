/**
 * HideOut — A 3D multiplayer prop-hunt game
 * Copyright (c) 2026 Sumit Gusain
 * Licensed under the MIT License - see LICENSE file for details
 *
 * Display policy for the visual taunt cue: the noise ping must give the hunter
 * a search AREA, not the hider's exact spot (a pinpoint beacon would delete the
 * guessing game that prop hunt is built on — playtest feedback).
 *
 * The offset is deterministic — seeded from (netId, position) — so:
 *  - every peer renders the ping at the SAME spot without any extra net traffic;
 *  - re-taunts from the same hiding place reuse the same offset, so a hunter
 *    can't average several pings to triangulate the true position.
 *
 * Pure math, no Babylon: unit-testable, usable by any renderer.
 */
import { mulberry32 } from '../core/math/random';
import type { AABB } from '../game/physics';

/** The cue lands 2–4.5 m away from the actual noise source. */
export const SCATTER_MIN_M = 2;
export const SCATTER_MAX_M = 4.5;

/** Deterministically offset a taunt position into a nearby "heard it around here" spot. */
export function scatterTauntPing(
  netId: number,
  x: number,
  z: number,
  bounds?: AABB,
): { x: number; z: number } {
  // Spatial-hash style seed: stable for (player, position), varies across both.
  const qx = Math.round(x * 10);
  const qz = Math.round(z * 10);
  const seed = (Math.imul(netId + 1, 73856093) ^ Math.imul(qx, 19349663) ^ Math.imul(qz, 83492791)) >>> 0;
  const rng = mulberry32(seed);

  const angle = rng() * Math.PI * 2;
  const dist = SCATTER_MIN_M + rng() * (SCATTER_MAX_M - SCATTER_MIN_M);
  let px = x + Math.sin(angle) * dist;
  let pz = z + Math.cos(angle) * dist;

  // Keep the cue inside the hall so the ring never draws beyond the walls.
  if (bounds) {
    px = Math.min(Math.max(px, bounds.minX + 1), bounds.maxX - 1);
    pz = Math.min(Math.max(pz, bounds.minZ + 1), bounds.maxZ - 1);
  }
  return { x: px, z: pz };
}
