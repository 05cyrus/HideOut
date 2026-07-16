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

/** Material family a surface resolves to in the renderer's procedural library. */
export type SurfaceKind = 'concrete' | 'paintedWall' | 'metal' | 'wood' | 'brick';

/** Non-possessable set-dressing. Render-only — never simulated, never on the wire. */
export type DecorationType = 'forklift' | 'dumpster' | 'ceilingLamp' | 'catwalk';

export interface DecorationPlacement {
  type: DecorationType;
  x: number;
  z: number;
  /** Radians. */
  yaw: number;
  /** Uniform/linear scale for stretchable decorations (catwalk length). Default 1. */
  scale?: number;
}

/** A glowing glass pane suggesting daylight — render-only (windows are non-breakable). */
export interface WindowDef {
  /** Pane center on the XZ plane. */
  x: number;
  z: number;
  /** Facing, radians (pane's normal direction). */
  yaw: number;
  /** Pane width (m). */
  width: number;
  /** Sill height above the floor (m). */
  sill: number;
  /** Pane height (m). */
  height: number;
}

/** Point light hung in the world (industrial fixtures — warm pools + dark corners). */
export interface PointLightDef {
  x: number;
  y: number;
  z: number;
  intensity: number;
  /** RGB 0-1. Defaults to warm white. */
  color?: readonly [number, number, number];
  range?: number;
}

/** Visual identity of a map. Data only — the renderer interprets every field. */
export interface MapTheme {
  floor: SurfaceKind;
  walls: SurfaceKind;
  clearColor?: readonly [number, number, number];
  ambientIntensity?: number;
  sunIntensity?: number;
  sunDirection?: readonly [number, number, number];
  /** Exponential fog density; omit/0 disables. */
  fogDensity?: number;
  fogColor?: readonly [number, number, number];
  pointLights?: readonly PointLightDef[];
}

export interface MapDef {
  id: string;
  name: string;
  /** Short blurb for the map picker. */
  description?: string;
  bounds: AABB;
  /** Solid geometry (walls, big furniture). Rendered as boxes, simulated as AABBs. */
  colliders: readonly AABB[];
  /** Wall render height (m). */
  wallHeight: number;
  /** Per-collider render height override (by collider index) — physics is 2D, so
   * this is purely visual (low shelf racks vs full-height walls). */
  colliderHeights?: Readonly<Record<number, number>>;
  /** Per-collider surface override (by collider index); defaults to theme.walls. */
  colliderSurfaces?: Readonly<Record<number, SurfaceKind>>;
  props: readonly PropPlacement[];
  hunterSpawn: SpawnPoint;
  hiderSpawns: readonly SpawnPoint[];
  /** Visual theme; renderer falls back to the classic flat look when omitted. */
  theme?: MapTheme;
  decorations?: readonly DecorationPlacement[];
  windows?: readonly WindowDef[];
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
  9: 0.45, // CardboardBox
  10: 0.65, // Pallet
  11: 0.25, // Cone
  12: 0.5, // Spool
};
