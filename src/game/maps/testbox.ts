/**
 * "Test Box" — a tiny map with hand-placed geometry used by unit/integration
 * tests and the headless bot harness. NOT shipped in the map rotation.
 *
 * Layout (top view):        crate (0,5)
 *                        ── wall (−0.5..0.5, 2..3)
 *   hiderB (−2,0)   hunter (0,0)        hiderA (9,0)  barrel (10,0)
 *                       plant (0,−5)
 */
import { PropType } from '../types';
import { aabb } from '../physics';
import { withConfig } from '../config';
import type { MapDef } from './types';

export const testBoxMap: MapDef = {
  id: 'testbox',
  name: 'Test Box',
  bounds: aabb(-20, -20, 20, 20),
  wallHeight: 3,
  colliders: [aabb(-0.5, 2, 0.5, 3)],
  props: [
    { id: 0, type: PropType.Crate, x: 0, z: 5, yaw: 0 },
    { id: 1, type: PropType.Plant, x: 0, z: -5, yaw: 0 },
    { id: 2, type: PropType.Barrel, x: 10, z: 0, yaw: 0 },
  ],
  hunterSpawn: { x: 0, z: 0, yaw: 0 },
  hiderSpawns: [
    { x: 9, z: 0, yaw: 0 },
    { x: -2, z: 0, yaw: 0 },
    { x: -4, z: 0, yaw: 0 },
  ],
};

/** 10 Hz sim with short phases: prep=3 ticks, hide=5, hunt=50, roundEnd=3. */
export const testBoxConfig = withConfig({
  tickRate: 10,
  round: {
    preparationSeconds: 0.3,
    hidingSeconds: 0.5,
    huntingSeconds: 5,
    roundEndSeconds: 0.3,
    minPlayers: 2,
  },
  hunter: { hp: 100, wrongPropDamage: 50, attackRange: 6, attackCooldownSeconds: 0.2 },
  props: { possessRange: 2.5, maxSwaps: 2, tauntCooldownSeconds: 1 },
});
