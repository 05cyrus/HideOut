/**
 * HideOut — A 3D multiplayer prop-hunt game
 * Copyright (c) 2026 Sumit Gusain
 * Licensed under the MIT License - see LICENSE file for details
 *
 * Map-validity suite: every registered map must satisfy the geometric and
 * prop-hunt invariants the sim/renderer rely on. These run on raw map DATA —
 * no Babylon — so a bad prop coordinate fails in milliseconds, not in a
 * playtest.
 */
import { describe, expect, it } from 'vitest';
import { circleIntersectsAABB } from '../physics';
import { PropType } from '../types';
import { mapList, maps } from './index';
import { PROP_RADIUS } from './types';

/** Sim player capsule radius (config.player.radius) + a hair of margin. */
const PLAYER_R = 0.45;

describe.each(mapList.map((m) => [m.name, m] as const))('map "%s"', (_name, map) => {
  it('is registered under its own id', () => {
    expect(maps[map.id]).toBe(map);
  });

  it('has sane bounds', () => {
    expect(map.bounds.maxX).toBeGreaterThan(map.bounds.minX);
    expect(map.bounds.maxZ).toBeGreaterThan(map.bounds.minZ);
    expect(map.wallHeight).toBeGreaterThan(2);
  });

  it('keeps all colliders inside (or at) the bounds', () => {
    for (const c of map.colliders) {
      expect(c.maxX).toBeGreaterThan(c.minX);
      expect(c.maxZ).toBeGreaterThan(c.minZ);
      expect(c.minX).toBeGreaterThanOrEqual(map.bounds.minX - 0.5);
      expect(c.maxX).toBeLessThanOrEqual(map.bounds.maxX + 0.5);
      expect(c.minZ).toBeGreaterThanOrEqual(map.bounds.minZ - 0.5);
      expect(c.maxZ).toBeLessThanOrEqual(map.bounds.maxZ + 0.5);
    }
  });

  it('has unique prop ids', () => {
    const ids = new Set(map.props.map((p) => p.id));
    expect(ids.size).toBe(map.props.length);
  });

  it('places every prop inside the bounds and outside all colliders', () => {
    for (const p of map.props) {
      const r = PROP_RADIUS[p.type];
      expect(r, `PROP_RADIUS missing for type ${p.type}`).toBeGreaterThan(0);
      expect(p.x, `prop ${p.id} x`).toBeGreaterThan(map.bounds.minX);
      expect(p.x, `prop ${p.id} x`).toBeLessThan(map.bounds.maxX);
      expect(p.z, `prop ${p.id} z`).toBeGreaterThan(map.bounds.minZ);
      expect(p.z, `prop ${p.id} z`).toBeLessThan(map.bounds.maxZ);
      for (const c of map.colliders) {
        expect(
          circleIntersectsAABB(p.x, p.z, 0.05, c),
          `prop ${p.id} (type ${PropType[p.type]}) at (${p.x}, ${p.z}) is inside a collider`,
        ).toBe(false);
      }
    }
  });

  it('never makes a possessed prop unique (every used type appears ≥3×)', () => {
    const counts = new Map<PropType, number>();
    for (const p of map.props) counts.set(p.type, (counts.get(p.type) ?? 0) + 1);
    for (const [type, count] of counts) {
      expect(count, `type ${PropType[type]} appears only ${count}×`).toBeGreaterThanOrEqual(3);
    }
  });

  it('spawns players inside the bounds and clear of colliders', () => {
    const spawns = [map.hunterSpawn, ...map.hiderSpawns];
    expect(map.hiderSpawns.length).toBeGreaterThanOrEqual(3);
    for (const s of spawns) {
      expect(s.x).toBeGreaterThan(map.bounds.minX + PLAYER_R);
      expect(s.x).toBeLessThan(map.bounds.maxX - PLAYER_R);
      expect(s.z).toBeGreaterThan(map.bounds.minZ + PLAYER_R);
      expect(s.z).toBeLessThan(map.bounds.maxZ - PLAYER_R);
      for (const c of map.colliders) {
        expect(
          circleIntersectsAABB(s.x, s.z, PLAYER_R, c),
          `spawn at (${s.x}, ${s.z}) intersects a collider`,
        ).toBe(false);
      }
    }
  });

  it('keeps decorations and windows within the hall', () => {
    for (const d of map.decorations ?? []) {
      expect(d.x).toBeGreaterThanOrEqual(map.bounds.minX);
      expect(d.x).toBeLessThanOrEqual(map.bounds.maxX);
      expect(d.z).toBeGreaterThanOrEqual(map.bounds.minZ);
      expect(d.z).toBeLessThanOrEqual(map.bounds.maxZ);
    }
    for (const w of map.windows ?? []) {
      expect(w.sill + w.height, 'window must fit under the wall top').toBeLessThanOrEqual(
        map.wallHeight,
      );
      expect(w.width).toBeGreaterThan(0);
    }
  });

  it('stays within the renderer light budget', () => {
    // materials.MAX_LIGHTS = 12 (mirrored here — game tests never import render/).
    const LIGHT_BUDGET = 12;
    const fixtures = map.theme?.pointLights?.length ?? 0;
    expect(fixtures + 2, 'point lights + sun + hemi exceed shader budget').toBeLessThanOrEqual(
      LIGHT_BUDGET,
    );
  });

  it('references only prop types with a radius entry', () => {
    for (const p of map.props) {
      expect(PROP_RADIUS[p.type]).toBeDefined();
      expect(p.type).not.toBe(PropType.None);
    }
  });
});
