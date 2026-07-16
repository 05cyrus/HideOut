/**
 * HideOut — A 3D multiplayer prop-hunt game
 * Copyright (c) 2026 Sumit Gusain
 * Licensed under the MIT License - see LICENSE file for details
 *
 * Map 02 — "Warehouse Depot". 70×60 m industrial hall from the design plan:
 *
 *   - Main entrance (N), side entrances (E/W), loading bay (S)
 *   - Four rooms-within-the-hall (3.4 m partitions, 2.5 m doorways):
 *     NW storage, NE office/storage, SW locker room, SE utility room
 *   - Central open warehouse: rack aisles, crate stacks, forklift centerpiece
 *   - Verticality DRESSING only: catwalks + high windows (sim stays 2D/ground)
 *   - Industrial lighting: warm fixture pools over lanes, dark corners between
 *
 * Prop-hunt placement rules (same as map 01): every type appears ≥3 times so a
 * possessed copy is never unique; clusters give "one more crate" spots; lone
 * props in the open are risky-but-legal choices.
 */
import { PropType } from '../types';
import { aabb, type AABB } from '../physics';
import type { MapDef, PropPlacement, SpawnPoint, SurfaceKind } from './types';

const P = PropType;

let nextId = 0;
function prop(type: PropType, x: number, z: number, yawDeg = 0): PropPlacement {
  return { id: nextId++, type, x, z, yaw: (yawDeg * Math.PI) / 180 };
}

// ── Solid geometry ───────────────────────────────────────────────────────────
// Collider indices key the per-collider render overrides, so the three arrays
// are built together through this helper.

const colliders: AABB[] = [];
const colliderHeights: Record<number, number> = {};
const colliderSurfaces: Record<number, SurfaceKind> = {};

function solid(box: AABB, height?: number, surface?: SurfaceKind): void {
  const i = colliders.length;
  colliders.push(box);
  if (height !== undefined) colliderHeights[i] = height;
  if (surface) colliderSurfaces[i] = surface;
}

const WALL_T = 0.4;
const ROOM_H = 3.4; // partition walls — rooms-within-the-hall, open to the trusses
const RACK_H = 2.6;
const STACK_H = 2.3;

// NW storage room: x[-35,-14], z[10,30]
solid(aabb(-35, 10, -25, 10 + WALL_T), ROOM_H); // south wall, west of door
solid(aabb(-22.5, 10, -14, 10 + WALL_T), ROOM_H); // south wall, east of door
solid(aabb(-14 - WALL_T, 10, -14, 18), ROOM_H); // east wall, south of door
solid(aabb(-14 - WALL_T, 20.5, -14, 30), ROOM_H); // east wall, north of door

// NE office/storage: x[14,35], z[12,30]
solid(aabb(14, 12, 14 + WALL_T, 20), ROOM_H); // west wall, south segment
solid(aabb(14, 22.5, 14 + WALL_T, 30), ROOM_H); // west wall, north segment
solid(aabb(14, 12, 24, 12 + WALL_T), ROOM_H); // south wall, west of door
solid(aabb(26.5, 12, 35, 12 + WALL_T), ROOM_H); // south wall, east of door

// SW locker room: x[-35,-18], z[-30,-12]
solid(aabb(-35, -12 - WALL_T, -28, -12), ROOM_H); // north wall, west of door
solid(aabb(-25.5, -12 - WALL_T, -18, -12), ROOM_H); // north wall, east of door
solid(aabb(-18 - WALL_T, -30, -18, -22), ROOM_H); // east wall, south segment
solid(aabb(-18 - WALL_T, -19.5, -18, -12), ROOM_H); // east wall, north segment

// SE utility room: x[18,35], z[-30,-14]
solid(aabb(18, -14 - WALL_T, 26, -14), ROOM_H); // north wall, west of door
solid(aabb(28.5, -14 - WALL_T, 35, -14), ROOM_H); // north wall, east of door
solid(aabb(18, -30, 18 + WALL_T, -23), ROOM_H); // west wall, south segment
solid(aabb(18, -20.5, 18 + WALL_T, -14), ROOM_H); // west wall, north segment

// Central rack aisles (low steel shelving — sightline breakers)
solid(aabb(-12, 3, -4, 4.2), RACK_H, 'metal');
solid(aabb(-12, -4.2, -4, -3), RACK_H, 'metal');
solid(aabb(4, 3, 12, 4.2), RACK_H, 'metal');
solid(aabb(4, -4.2, 12, -3), RACK_H, 'metal');
solid(aabb(-10, -13.2, -2, -12), RACK_H, 'metal'); // south racks, offset gaps
solid(aabb(2, -13.2, 10, -12), RACK_H, 'metal');

// Crate stacks (solid, circle-around-able)
solid(aabb(-2.2, 6, 2.2, 9), STACK_H, 'wood'); // central, behind the forklift
solid(aabb(-33, 24, -28, 28), STACK_H, 'wood'); // NW room corner stack
solid(aabb(-8, -26, -4, -23), STACK_H, 'wood'); // loading bay west stack
solid(aabb(5, -25, 8, -22), STACK_H, 'wood'); // loading bay east stack

// Structural columns (full height)
solid(aabb(-11.3, 9.7, -10.7, 10.3), undefined, 'concrete');
solid(aabb(10.7, 9.7, 11.3, 10.3), undefined, 'concrete');
solid(aabb(-11.3, -10.3, -10.7, -9.7), undefined, 'concrete');
solid(aabb(10.7, -10.3, 11.3, -9.7), undefined, 'concrete');

// ── Props (~90; every type ≥3×) ──────────────────────────────────────────────

const props: PropPlacement[] = [
  // — NW storage room: crate depot + pallets + spools —
  prop(P.Crate, -31.5, 21.5, 15),
  prop(P.Crate, -30.0, 22.6, 70),
  prop(P.Crate, -26.5, 26.5, 40),
  prop(P.Crate, -25.2, 27.6, 5),
  prop(P.Pallet, -32.0, 16.0, 10),
  prop(P.Pallet, -30.6, 14.8, 85),
  prop(P.Spool, -20.0, 26.5),
  prop(P.Spool, -17.5, 24.0),
  prop(P.CardboardBox, -22.0, 14.0, 30),
  prop(P.CardboardBox, -20.8, 12.8, 60),
  prop(P.Barrel, -17.0, 16.5),
  prop(P.Shelf, -27.0, 11.2, 0),
  prop(P.Shelf, -24.8, 11.2, 0),

  // — NE office/storage: desks, chairs, plants, boxes —
  prop(P.Table, 19.5, 26.5, 90),
  prop(P.Chair, 18.6, 25.4, 130),
  prop(P.Chair, 20.6, 27.4, -50),
  prop(P.Table, 25.0, 28.0),
  prop(P.Chair, 24.2, 26.9, 170),
  prop(P.Table, 31.0, 24.0, 90),
  prop(P.Chair, 31.9, 25.0, -110),
  prop(P.Lamp, 33.2, 28.5),
  prop(P.Lamp, 16.2, 28.6),
  prop(P.Plant, 33.0, 14.5),
  prop(P.Plant, 16.5, 14.0),
  prop(P.Plant, 25.5, 21.0),
  prop(P.CardboardBox, 29.0, 17.0, 20),
  prop(P.CardboardBox, 30.4, 16.2, 55),
  prop(P.CardboardBox, 29.6, 18.4, 80),
  prop(P.Shelf, 22.0, 29.2, 0),
  prop(P.TrashCan, 17.5, 20.5),

  // — SW locker room: locker rows (shelves), bench (table+chairs), bins —
  prop(P.Shelf, -33.8, -16.0, 90),
  prop(P.Shelf, -33.8, -18.2, 90),
  prop(P.Shelf, -33.8, -20.4, 90),
  prop(P.Shelf, -19.6, -25.0, -90),
  prop(P.Table, -27.0, -21.0),
  prop(P.Chair, -25.8, -22.0, 90),
  prop(P.Chair, -28.2, -20.0, -90),
  prop(P.Lamp, -33.5, -28.5),
  prop(P.TrashCan, -19.5, -13.8),
  prop(P.CardboardBox, -30.0, -27.5, 45),
  prop(P.CardboardBox, -28.6, -26.6, 10),
  prop(P.Plant, -22.0, -28.5),

  // — SE utility room: barrels, spools, cones —
  prop(P.Barrel, 32.5, -27.5),
  prop(P.Barrel, 33.6, -26.2),
  prop(P.Barrel, 32.2, -25.0),
  prop(P.Barrel, 21.5, -27.0),
  prop(P.Spool, 25.5, -26.5),
  prop(P.Spool, 28.0, -24.5),
  prop(P.Cone, 20.5, -16.5),
  prop(P.Cone, 22.0, -15.8),
  prop(P.Crate, 31.5, -17.5, 25),
  prop(P.TrashCan, 24.0, -20.0),

  // — Central warehouse: clusters around the forklift + rack ends —
  prop(P.Crate, -3.6, 4.9, 20),
  prop(P.Crate, 3.4, 5.2, 65),
  prop(P.Crate, 2.9, 10.4, 10),
  prop(P.Crate, -3.2, 10.2, 45),
  prop(P.Barrel, -13.5, 3.6),
  prop(P.Barrel, 13.5, -3.6),
  prop(P.Barrel, -13.4, -3.8),
  prop(P.Pallet, -6.0, 0.0, 15),
  prop(P.Pallet, 6.2, 0.4, 80),
  prop(P.Pallet, 0.0, -6.5, 40),
  prop(P.CardboardBox, -2.0, 0.5, 30),
  prop(P.CardboardBox, 1.8, -1.4, 75),
  prop(P.CardboardBox, 13.2, 4.8, 15),
  prop(P.Cone, 0.0, 12.5),
  prop(P.TrashCan, -13.4, -12.6),
  prop(P.Plant, 0.5, -16.0),
  prop(P.Crate, 12.8, -13.6, 30),
  prop(P.Crate, -12.6, -14.0, 55),

  // — North hall: entrance oddments + wall shelves —
  prop(P.Plant, -3.8, 27.5),
  prop(P.Plant, 3.8, 27.5),
  prop(P.Cone, -3.0, 24.0),
  prop(P.Cone, 3.0, 24.0),
  prop(P.Shelf, 8.5, 28.9, 0),
  prop(P.TrashCan, 6.2, 27.8),
  prop(P.Crate, -8.0, 26.0, 35),
  prop(P.Crate, -9.4, 24.8, 5),
  prop(P.Barrel, 11.5, 25.5),
  prop(P.Spool, -6.5, 17.0),
  prop(P.Lamp, 12.8, 17.0),

  // — Loading bay (south): pallet field + cardboard + cones —
  prop(P.Pallet, -1.5, -22.0, 5),
  prop(P.Pallet, 1.2, -23.4, 90),
  prop(P.Pallet, -3.0, -27.0, 45),
  prop(P.Pallet, 12.0, -27.0, 10),
  prop(P.CardboardBox, 0.2, -26.0, 20),
  prop(P.CardboardBox, 1.6, -27.2, 65),
  prop(P.CardboardBox, -1.2, -28.0, 40),
  prop(P.Cone, -6.0, -20.5),
  prop(P.Cone, 6.0, -20.5),
  prop(P.Barrel, -12.5, -27.5),
  prop(P.Barrel, -11.2, -26.3),
  prop(P.Crate, 11.0, -24.0, 20),
  prop(P.Crate, 12.4, -25.2, 75),
  prop(P.TrashCan, 14.5, -28.5),

  // — West hall: barrels + shelves along the wall —
  prop(P.Shelf, -34.0, 6.0, 90),
  prop(P.Shelf, -34.0, 3.8, 90),
  prop(P.Barrel, -33.0, -6.5),
  prop(P.Barrel, -31.8, -7.6),
  prop(P.Crate, -29.5, 5.5, 50),
  prop(P.Pallet, -26.0, -3.0, 20),

  // — East hall: spool + crates near side entrance —
  prop(P.Spool, 32.5, 7.5),
  prop(P.Crate, 32.0, 3.0, 15),
  prop(P.CardboardBox, 30.5, -3.5, 50),
  prop(P.Pallet, 27.0, 6.0, 70),
  prop(P.Plant, 33.5, -8.0),
];

// ── Spawns ───────────────────────────────────────────────────────────────────

const hiderSpawns: SpawnPoint[] = [
  // NW room
  { x: -24, z: 22, yaw: Math.PI * 0.75 },
  { x: -19, z: 15, yaw: Math.PI },
  { x: -29, z: 18, yaw: Math.PI / 2 },
  // NE room
  { x: 24, z: 24, yaw: Math.PI },
  { x: 19, z: 17, yaw: -Math.PI / 2 },
  { x: 30, z: 20, yaw: Math.PI },
  // SW room
  { x: -26, z: -17, yaw: 0 },
  { x: -22, z: -25, yaw: 0 },
  { x: -31, z: -24, yaw: Math.PI / 2 },
  // SE room
  { x: 24, z: -18, yaw: 0 },
  { x: 30, z: -21, yaw: -Math.PI / 2 },
  { x: 26, z: -28, yaw: 0 },
  // Central
  { x: -8, z: 8, yaw: Math.PI },
  { x: 8, z: -8, yaw: 0 },
  { x: -8, z: -8, yaw: 0 },
  { x: 8, z: 8, yaw: Math.PI },
  // Loading bay
  { x: 0, z: -18, yaw: 0 },
  { x: -10, z: -20, yaw: -Math.PI / 2 },
  { x: 10, z: -18, yaw: Math.PI / 2 },
];

// ── Map ──────────────────────────────────────────────────────────────────────

export const warehouseDepotMap: MapDef = {
  id: 'depot',
  name: 'Warehouse Depot',
  description: '70×60 m industrial depot — four rooms, rack aisles, loading bay. 2–20 players.',
  bounds: aabb(-35, -30, 35, 30),
  wallHeight: 6,
  colliders,
  colliderHeights,
  colliderSurfaces,
  props,
  // Main entrance (north), facing down the central lane.
  hunterSpawn: { x: 0, z: 26.5, yaw: Math.PI },
  hiderSpawns,
  theme: {
    floor: 'concrete',
    walls: 'paintedWall',
    clearColor: [0.03, 0.04, 0.05],
    ambientIntensity: 0.55,
    sunIntensity: 1.5,
    sunDirection: [-0.35, -1, 0.2],
    fogDensity: 0.0045,
    fogColor: [0.05, 0.055, 0.07],
    // Warm fixture pools over the lanes; corners stay dim on purpose.
    // (PBR point lights use physical 1/d² falloff — intensities are premultiplied
    // for a ~4.6 m drop to the floor.)
    pointLights: [
      { x: 0, y: 4.6, z: 5, intensity: 40, range: 24, color: [1, 0.85, 0.66] },
      { x: -8, y: 4.6, z: 0, intensity: 40, range: 24, color: [1, 0.85, 0.66] },
      { x: 8, y: 4.6, z: 0, intensity: 40, range: 24, color: [1, 0.85, 0.66] },
      { x: 0, y: 4.6, z: -20, intensity: 40, range: 24, color: [1, 0.85, 0.66] },
      { x: -25, y: 4.6, z: 20, intensity: 32, range: 22, color: [0.95, 0.9, 0.8] },
      { x: 25, y: 4.6, z: 21, intensity: 32, range: 22, color: [0.95, 0.9, 0.8] },
      { x: -26, y: 4.6, z: -21, intensity: 32, range: 22, color: [0.95, 0.9, 0.8] },
      { x: 26, y: 4.6, z: -22, intensity: 32, range: 22, color: [0.95, 0.9, 0.8] },
      { x: 0, y: 4.6, z: 16, intensity: 40, range: 24, color: [1, 0.85, 0.66] },
      { x: -20, y: 4.6, z: -5, intensity: 32, range: 22, color: [1, 0.85, 0.66] },
    ],
  },
  decorations: [
    { type: 'forklift', x: 0, z: 2.5, yaw: 0.4 }, // centerpiece, forks toward main lane
    { type: 'forklift', x: -14, z: -21, yaw: -2.2 }, // loading bay
    { type: 'dumpster', x: 14.5, z: -20.5, yaw: 0.1 },
    { type: 'dumpster', x: -30, z: -4, yaw: Math.PI / 2 },
    // catwalk along the NW room's north wall (plan: high ground dressing)
    { type: 'catwalk', x: -22, z: 28.6, yaw: Math.PI, scale: 2 },
    // catwalk on the east wall, north of the side entrance
    { type: 'catwalk', x: 33.6, z: 10, yaw: -Math.PI / 2, scale: 1.5 },
    // hanging fixtures — one per theme point light
    { type: 'ceilingLamp', x: 0, z: 5, yaw: 0 },
    { type: 'ceilingLamp', x: -8, z: 0, yaw: 0 },
    { type: 'ceilingLamp', x: 8, z: 0, yaw: 0 },
    { type: 'ceilingLamp', x: 0, z: -20, yaw: 0 },
    { type: 'ceilingLamp', x: -25, z: 20, yaw: 0 },
    { type: 'ceilingLamp', x: 25, z: 21, yaw: 0 },
    { type: 'ceilingLamp', x: -26, z: -21, yaw: 0 },
    { type: 'ceilingLamp', x: 26, z: -22, yaw: 0 },
    { type: 'ceilingLamp', x: 0, z: 16, yaw: 0 },
    { type: 'ceilingLamp', x: -20, z: -5, yaw: 0 },
  ],
  windows: [
    // high window rows (sill 3.6) — bright panes for the day-lit look
    { x: -34.85, z: -20, yaw: Math.PI / 2, width: 4, sill: 3.6, height: 1.4 },
    { x: -34.85, z: -12, yaw: Math.PI / 2, width: 4, sill: 3.6, height: 1.4 },
    { x: -34.85, z: 8, yaw: Math.PI / 2, width: 4, sill: 3.6, height: 1.4 },
    { x: -34.85, z: 16, yaw: Math.PI / 2, width: 4, sill: 3.6, height: 1.4 },
    { x: -34.85, z: 24, yaw: Math.PI / 2, width: 4, sill: 3.6, height: 1.4 },
    { x: 34.85, z: -22, yaw: -Math.PI / 2, width: 4, sill: 3.6, height: 1.4 },
    { x: 34.85, z: -8, yaw: -Math.PI / 2, width: 4, sill: 3.6, height: 1.4 },
    { x: 34.85, z: 8, yaw: -Math.PI / 2, width: 4, sill: 3.6, height: 1.4 },
    { x: 34.85, z: 16, yaw: -Math.PI / 2, width: 4, sill: 3.6, height: 1.4 },
    { x: 34.85, z: 24, yaw: -Math.PI / 2, width: 4, sill: 3.6, height: 1.4 },
    { x: -28, z: 29.85, yaw: Math.PI, width: 4, sill: 3.6, height: 1.4 },
    { x: -12, z: 29.85, yaw: Math.PI, width: 4, sill: 3.6, height: 1.4 },
    { x: 12, z: 29.85, yaw: Math.PI, width: 4, sill: 3.6, height: 1.4 },
    { x: 26, z: 29.85, yaw: Math.PI, width: 4, sill: 3.6, height: 1.4 },
    { x: -18, z: -29.85, yaw: 0, width: 4, sill: 3.6, height: 1.4 },
    { x: -10, z: -29.85, yaw: 0, width: 4, sill: 3.6, height: 1.4 },
    { x: 12, z: -29.85, yaw: 0, width: 4, sill: 3.6, height: 1.4 },
    { x: 20, z: -29.85, yaw: 0, width: 4, sill: 3.6, height: 1.4 },
    // door-light panes at the four entrances (visual daylight spill)
    { x: 0, z: 29.85, yaw: Math.PI, width: 5, sill: 0, height: 4.2 }, // main (N)
    { x: 0, z: -29.85, yaw: 0, width: 7, sill: 0, height: 3.8 }, // loading bay (S)
    { x: 34.85, z: 0, yaw: -Math.PI / 2, width: 3, sill: 0, height: 3 }, // east
    { x: -34.85, z: 0, yaw: Math.PI / 2, width: 3, sill: 0, height: 3 }, // west
  ],
};
