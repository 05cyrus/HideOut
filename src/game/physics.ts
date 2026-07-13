/**
 * Deterministic 2D (XZ-plane) collision for the simulation.
 *
 * Design note: movement is NOT delegated to Babylon's `moveWithCollisions` — the host
 * must simulate every player headless, and clients must replay inputs bit-identically
 * for prediction/reconciliation. So collision is pure TypeScript: players are circles,
 * the world is axis-aligned boxes (walls, large furniture). Babylon only renders.
 * Vertical gameplay is a later milestone; y stays 0 in the sim (eye height is applied
 * at render time).
 */
import type { Vec3 } from '../core/math/vec3';

/** Axis-aligned box on the XZ plane. */
export interface AABB {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export interface CollisionWorld {
  /** Playable area; players are clamped inside. */
  bounds: AABB;
  /** Solid obstacles. */
  colliders: readonly AABB[];
}

export function aabb(minX: number, minZ: number, maxX: number, maxZ: number): AABB {
  return { minX, minZ, maxX, maxZ };
}

/** Circle-vs-AABB overlap test. */
export function circleIntersectsAABB(cx: number, cz: number, r: number, box: AABB): boolean {
  const nx = Math.max(box.minX, Math.min(cx, box.maxX));
  const nz = Math.max(box.minZ, Math.min(cz, box.maxZ));
  const dx = cx - nx;
  const dz = cz - nz;
  return dx * dx + dz * dz < r * r;
}

/**
 * Contact skin: push-outs leave this gap so the resolved position never re-tests
 * as intersecting due to floating-point rounding (resting-contact jitter).
 */
const SKIN = 1e-3;

/**
 * Move a circle by (dx, dz) with axis-separated collide-and-slide:
 * apply the X displacement and push out of any box, then the same for Z.
 * Axis separation gives the classic "slide along walls" feel and is
 * order-independent enough for our axis-aligned worlds. Mutates `pos`.
 */
export function moveCircle(
  pos: Vec3,
  r: number,
  dx: number,
  dz: number,
  world: CollisionWorld,
): void {
  // X axis
  pos.x += dx;
  for (const box of world.colliders) {
    if (circleIntersectsAABB(pos.x, pos.z, r, box)) {
      pos.x = dx > 0 ? box.minX - r - SKIN : box.maxX + r + SKIN;
    }
  }
  pos.x = Math.min(Math.max(pos.x, world.bounds.minX + r), world.bounds.maxX - r);

  // Z axis
  pos.z += dz;
  for (const box of world.colliders) {
    if (circleIntersectsAABB(pos.x, pos.z, r, box)) {
      pos.z = dz > 0 ? box.minZ - r - SKIN : box.maxZ + r + SKIN;
    }
  }
  pos.z = Math.min(Math.max(pos.z, world.bounds.minZ + r), world.bounds.maxZ - r);
}

/**
 * Ray vs circle on the XZ plane. Ray direction must be normalized.
 * Returns the distance along the ray to the first intersection, or null.
 */
export function rayCircle(
  ox: number,
  oz: number,
  dirX: number,
  dirZ: number,
  cx: number,
  cz: number,
  r: number,
): number | null {
  const lx = cx - ox;
  const lz = cz - oz;
  const tca = lx * dirX + lz * dirZ; // projection of center onto ray
  if (tca < 0) return null; // behind the origin
  const d2 = lx * lx + lz * lz - tca * tca; // perpendicular distance²
  if (d2 > r * r) return null;
  const thc = Math.sqrt(r * r - d2);
  const t = tca - thc;
  return t >= 0 ? t : tca + thc; // origin inside circle → exit point
}

/**
 * Ray vs AABB (2D slab test). Ray direction must be normalized.
 * Returns entry distance along the ray, or null if no hit ahead of the origin.
 */
export function rayAABB(
  ox: number,
  oz: number,
  dirX: number,
  dirZ: number,
  box: AABB,
): number | null {
  let tmin = -Infinity;
  let tmax = Infinity;

  if (dirX !== 0) {
    const t1 = (box.minX - ox) / dirX;
    const t2 = (box.maxX - ox) / dirX;
    tmin = Math.max(tmin, Math.min(t1, t2));
    tmax = Math.min(tmax, Math.max(t1, t2));
  } else if (ox < box.minX || ox > box.maxX) {
    return null;
  }

  if (dirZ !== 0) {
    const t1 = (box.minZ - oz) / dirZ;
    const t2 = (box.maxZ - oz) / dirZ;
    tmin = Math.max(tmin, Math.min(t1, t2));
    tmax = Math.min(tmax, Math.max(t1, t2));
  } else if (oz < box.minZ || oz > box.maxZ) {
    return null;
  }

  if (tmax < tmin || tmax < 0) return null;
  return tmin >= 0 ? tmin : 0; // origin inside box → hit at 0
}

/** Distance to the nearest wall hit along a ray, or Infinity when unobstructed. */
export function raycastWalls(
  ox: number,
  oz: number,
  dirX: number,
  dirZ: number,
  world: CollisionWorld,
): number {
  let nearest = Infinity;
  for (const box of world.colliders) {
    const t = rayAABB(ox, oz, dirX, dirZ, box);
    if (t !== null && t < nearest) nearest = t;
  }
  return nearest;
}
