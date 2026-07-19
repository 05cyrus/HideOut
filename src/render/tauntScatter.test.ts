/**
 * HideOut — A 3D multiplayer prop-hunt game
 * Copyright (c) 2026 Sumit Gusain
 * Licensed under the MIT License - see LICENSE file for details
 */
import { describe, expect, it } from 'vitest';
import { aabb } from '../game/physics';
import { SCATTER_MAX_M, SCATTER_MIN_M, scatterTauntPing } from './tauntScatter';

describe('scatterTauntPing', () => {
  it('never lands on the hider: offset stays within [min, max] meters', () => {
    for (let netId = 0; netId < 8; netId++) {
      for (const [x, z] of [
        [0, 0],
        [12.3, -7.9],
        [-16.5, 10.5],
        [33.1, 28.4],
      ] as const) {
        const p = scatterTauntPing(netId, x, z);
        const dist = Math.hypot(p.x - x, p.z - z);
        expect(dist).toBeGreaterThanOrEqual(SCATTER_MIN_M - 1e-9);
        expect(dist).toBeLessThanOrEqual(SCATTER_MAX_M + 1e-9);
      }
    }
  });

  it('is deterministic: same (netId, position) → same cue on every peer', () => {
    const a = scatterTauntPing(3, 5.5, -2.25);
    const b = scatterTauntPing(3, 5.5, -2.25);
    expect(a).toEqual(b);
  });

  it('varies across players and positions (no shared fixed offset)', () => {
    const base = scatterTauntPing(1, 5, 5);
    const otherPlayer = scatterTauntPing(2, 5, 5);
    const otherSpot = scatterTauntPing(1, -9, 12);
    expect(otherPlayer).not.toEqual(base);
    expect(otherSpot).not.toEqual(base);
  });

  it('clamps the cue inside the map bounds', () => {
    const bounds = aabb(-18, -12, 18, 12);
    // Corner position: raw scatter could leave the hall; clamped version cannot.
    for (let netId = 0; netId < 12; netId++) {
      const p = scatterTauntPing(netId, 17.5, 11.5, bounds);
      expect(p.x).toBeGreaterThanOrEqual(bounds.minX + 1);
      expect(p.x).toBeLessThanOrEqual(bounds.maxX - 1);
      expect(p.z).toBeGreaterThanOrEqual(bounds.minZ + 1);
      expect(p.z).toBeLessThanOrEqual(bounds.maxZ - 1);
    }
  });
});
