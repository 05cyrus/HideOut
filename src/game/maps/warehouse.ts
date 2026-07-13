/**
 * Map 01 — "Warehouse". The vertical-slice map.
 *
 * 36×24 m hall. Two shelf aisles split the space into three lanes; crate clusters
 * and furniture corners create hiding pockets with broken sightlines. Prop
 * placement rules that make prop-hunt work:
 *  - every prop type appears ≥3 times, so a possessed copy is never unique
 *  - clusters (crate stacks, shelf rows) give natural "one more crate" spots
 *  - lone props in open floor exist too — risky spots, player's choice
 */
import { PropType } from '../types';
import { aabb } from '../physics';
import type { MapDef, PropPlacement } from './types';

const P = PropType;

let nextId = 0;
function prop(type: PropType, x: number, z: number, yawDeg = 0): PropPlacement {
  return { id: nextId++, type, x, z, yaw: (yawDeg * Math.PI) / 180 };
}

const props: PropPlacement[] = [
  // --- North-west crate depot (cluster of 6) ---
  prop(P.Crate, -14.0, 8.5),
  prop(P.Crate, -12.6, 8.5, 15),
  prop(P.Crate, -13.3, 7.2, 40),
  prop(P.Crate, -11.2, 7.8, 75),
  prop(P.Crate, -14.2, 6.1, 10),
  prop(P.Crate, -10.0, 8.8, 55),

  // --- Aisle A shelves (solid colliders below) with barrels at the ends ---
  prop(P.Barrel, -6.5, 5.6),
  prop(P.Barrel, 6.5, 5.6),
  prop(P.Barrel, -6.5, 2.4),

  // --- Office corner, south-west: tables/chairs/lamp/plants ---
  prop(P.Table, -13.0, -6.5, 90),
  prop(P.Chair, -13.9, -7.6, 120),
  prop(P.Chair, -12.1, -5.4, -60),
  prop(P.Table, -10.0, -8.5),
  prop(P.Chair, -9.2, -9.4, 180),
  prop(P.Lamp, -14.5, -9.5),
  prop(P.Plant, -14.5, -4.5),
  prop(P.Plant, -8.0, -6.0),

  // --- Central floor: scattered, riskier ---
  prop(P.Barrel, 0.0, 0.0),
  prop(P.Crate, 1.8, -1.2, 30),
  prop(P.TrashCan, -1.5, 1.6),
  prop(P.Plant, 0.5, 3.8),

  // --- Aisle B shelves with trash cans + crates near the ends ---
  prop(P.TrashCan, -6.5, -2.4),
  prop(P.TrashCan, 6.5, -5.6),
  prop(P.Crate, 6.8, -2.2, 20),

  // --- East loading zone: barrels + crate row ---
  prop(P.Barrel, 12.5, 7.0),
  prop(P.Barrel, 13.8, 6.2),
  prop(P.Barrel, 13.0, 4.6),
  prop(P.Crate, 15.0, 8.0, 5),
  prop(P.Crate, 15.2, 6.4, 85),
  prop(P.Crate, 14.0, 2.5, 45),

  // --- South-east breakroom: table set, lamps, plant ---
  prop(P.Table, 12.0, -7.0),
  prop(P.Chair, 11.0, -8.0, -45),
  prop(P.Chair, 13.0, -6.0, 135),
  prop(P.Chair, 13.2, -8.2, 90),
  prop(P.Lamp, 15.0, -9.0),
  prop(P.Lamp, 9.5, -9.3),
  prop(P.Plant, 15.2, -4.8),

  // --- Along the north wall ---
  prop(P.Shelf, 0.0, 10.8, 0),
  prop(P.Shelf, 3.0, 10.8, 0),
  prop(P.TrashCan, -3.2, 10.5),
  prop(P.Lamp, 8.0, 10.5),

  // --- South wall oddments ---
  prop(P.Crate, -2.0, -10.2, 10),
  prop(P.Barrel, 2.5, -10.0),
  prop(P.Plant, 6.0, -10.4),
];

export const warehouseMap: MapDef = {
  id: 'warehouse',
  name: 'Warehouse',
  bounds: aabb(-18, -12, 18, 12),
  wallHeight: 4,
  colliders: [
    // Aisle A (north): two shelf runs with a gap at x≈0 to pass through
    aabb(-6, 3.2, -1.5, 4.8),
    aabb(1.5, 3.2, 6, 4.8),
    // Aisle B (south): offset gaps to force lane changes
    aabb(-6, -4.8, -3, -3.2),
    aabb(-1, -4.8, 6, -3.2),
    // NW depot backdrop — a big stack you can circle around
    aabb(-16.5, 9.5, -11.5, 11.0),
    // East dock pillar pair
    aabb(10.5, 0.5, 11.5, 1.5),
    aabb(10.5, -1.5, 11.5, -0.5),
  ],
  props,
  hunterSpawn: { x: 17, z: 0, yaw: -Math.PI / 2 },
  hiderSpawns: [
    { x: -16.5, z: 0, yaw: Math.PI / 2 },
    { x: -16.5, z: 3, yaw: Math.PI / 2 },
    { x: -16.5, z: -3, yaw: Math.PI / 2 },
    { x: -16.5, z: 6, yaw: Math.PI / 2 },
    { x: -16.5, z: -6, yaw: Math.PI / 2 },
    { x: -15, z: 9, yaw: Math.PI / 2 },
    { x: -15, z: -9, yaw: Math.PI / 2 },
    { x: -16.5, z: 10.5, yaw: Math.PI / 2 },
    { x: -16.5, z: -10.5, yaw: Math.PI / 2 },
    { x: -13, z: 0, yaw: Math.PI / 2 },
    { x: -13, z: 3, yaw: Math.PI / 2 },
  ],
};

export const maps: Record<string, MapDef> = {
  [warehouseMap.id]: warehouseMap,
};
