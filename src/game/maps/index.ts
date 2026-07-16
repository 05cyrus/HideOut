/**
 * HideOut — A 3D multiplayer prop-hunt game
 * Copyright (c) 2026 Sumit Gusain
 * Licensed under the MIT License - see LICENSE file for details
 *
 * Map registry. Maps are code shipped identically to every client, so the
 * host only ever sends a `mapId` over the wire (see the welcome event) and
 * both sides resolve it here. The test box is deliberately NOT registered —
 * it exists for unit/integration harnesses only.
 */
import type { MapDef } from './types';
import { warehouseMap } from './warehouse';
import { warehouseDepotMap } from './warehouseDepot';

export { warehouseMap } from './warehouse';
export { warehouseDepotMap } from './warehouseDepot';
export type { MapDef } from './types';

export const maps: Record<string, MapDef> = {
  [warehouseMap.id]: warehouseMap,
  [warehouseDepotMap.id]: warehouseDepotMap,
};

/** Rotation order shown in the host's map picker. */
export const mapList: readonly MapDef[] = [warehouseMap, warehouseDepotMap];
