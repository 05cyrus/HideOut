import type { AABB } from '../physics';
import type { PropType } from '../types';

/** A static prop placed in the map. `id` is its index — stable across peers
 * because map data is code shipped identically to every client. */
export interface PropPlacement {
  id: number;
  type: PropType;
  x: number;
  z: number;
  /** Radians. */
  yaw: number;
}

export interface SpawnPoint {
  x: number;
  z: number;
  yaw: number;
}

export interface MapDef {
  id: string;
  name: string;
  bounds: AABB;
  /** Solid geometry (walls, big furniture). Rendered as boxes, simulated as AABBs. */
  colliders: readonly AABB[];
  /** Wall render height (m). */
  wallHeight: number;
  props: readonly PropPlacement[];
  hunterSpawn: SpawnPoint;
  hiderSpawns: readonly SpawnPoint[];
}

/** Attack-ray target radius per prop type (m) — roughly its physical footprint. */
export const PROP_RADIUS: Record<PropType, number> = {
  0: 0.4, // None → player capsule radius
  1: 0.55, // Crate
  2: 0.45, // Barrel
  3: 0.35, // Plant
  4: 0.4, // Chair
  5: 0.7, // Table
  6: 0.3, // Lamp
  7: 0.6, // Shelf
  8: 0.35, // TrashCan
};
