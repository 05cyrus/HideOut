/**
 * HideOut — A 3D multiplayer prop-hunt game
 * Copyright (c) 2026 Sumit Gusain
 * Licensed under the MIT License - see LICENSE file for details
 *
 * Procedural PBR material library. Every texture is generated at init time on a
 * canvas (seeded value-noise → albedo + normal map), so the game still ships
 * ZERO art assets and works fully offline — but surfaces get real grain,
 * roughness, and bump response under the industrial lighting rig.
 *
 * Design notes:
 *  - Textures are TILEABLE (wrapped noise lattice), sampled in world space via
 *    `applyWorldUVs`, so one shared material covers walls of any size at a
 *    uniform texel density (instancing/draw-call count is unchanged).
 *  - Generation is seeded (mulberry32) → every client renders identical
 *    surfaces, and screenshots are reproducible in e2e runs.
 *  - Props keep their vertex-color tints; they share ONE mostly-white grunge
 *    PBR material, so each archetype remains a single draw call.
 */
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import type { Scene } from '@babylonjs/core/scene';
import { mulberry32 } from '../../core/math/random';
import type { SurfaceKind } from '../../game/maps/types';

/** Max lights a surface shader supports (dir + hemi + point fixtures). */
export const MAX_LIGHTS = 12;

const TEX_SIZE = 512;

// ── Seeded, tileable noise ───────────────────────────────────────────────────

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Tileable value noise: a wrapped random lattice, bilinearly interpolated. */
function valueNoise(rng: () => number, size: number, cell: number): Float32Array {
  const n = Math.max(1, Math.round(size / cell));
  const g = new Float32Array(n * n);
  for (let i = 0; i < g.length; i++) g[i] = rng();
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const gy = (y / size) * n;
    const y0 = Math.floor(gy) % n;
    const y1 = (y0 + 1) % n;
    const fy = smooth(gy - Math.floor(gy));
    for (let x = 0; x < size; x++) {
      const gx = (x / size) * n;
      const x0 = Math.floor(gx) % n;
      const x1 = (x0 + 1) % n;
      const fx = smooth(gx - Math.floor(gx));
      const a = g[y0 * n + x0]! + (g[y0 * n + x1]! - g[y0 * n + x0]!) * fx;
      const b = g[y1 * n + x0]! + (g[y1 * n + x1]! - g[y1 * n + x0]!) * fx;
      out[y * size + x] = a + (b - a) * fy;
    }
  }
  return out;
}

/** Sum of noise octaves, normalized to [0, 1]. */
function fbm(rng: () => number, size: number, baseCell: number, octaves: number): Float32Array {
  const out = new Float32Array(size * size);
  let amp = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const layer = valueNoise(rng, size, Math.max(2, baseCell >> o));
    for (let i = 0; i < out.length; i++) out[i]! += layer[i]! * amp;
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i]! /= total;
  return out;
}

// ── Texture builders ─────────────────────────────────────────────────────────

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function makeTexture(scene: Scene, name: string, draw: (ctx: Ctx, size: number) => void) {
  const dt = new DynamicTexture(name, { width: TEX_SIZE, height: TEX_SIZE }, scene, true);
  draw(dt.getContext() as Ctx, TEX_SIZE);
  dt.update();
  dt.anisotropicFilteringLevel = 8;
  return dt;
}

/** Convert a height field to a tangent-space normal map (wrapped Sobel). */
function makeNormalTexture(scene: Scene, name: string, height: Float32Array, strength: number) {
  const dt = new DynamicTexture(name, { width: TEX_SIZE, height: TEX_SIZE }, scene, true);
  const ctx = dt.getContext() as Ctx;
  const img = ctx.createImageData(TEX_SIZE, TEX_SIZE);
  const s = TEX_SIZE;
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const xm = (x - 1 + s) % s;
      const xp = (x + 1) % s;
      const ym = (y - 1 + s) % s;
      const yp = (y + 1) % s;
      const dx = (height[y * s + xp]! - height[y * s + xm]!) * strength;
      const dy = (height[yp * s + x]! - height[ym * s + x]!) * strength;
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const i = (y * s + x) * 4;
      img.data[i] = Math.round((-dx * inv * 0.5 + 0.5) * 255);
      img.data[i + 1] = Math.round((-dy * inv * 0.5 + 0.5) * 255);
      img.data[i + 2] = Math.round((inv * 0.5 + 0.5) * 255);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  dt.update();
  dt.gammaSpace = false; // normal data is linear
  return dt;
}

/** Fill the canvas from a noise field mapped between two colors. */
function paintNoise(
  ctx: Ctx,
  size: number,
  field: Float32Array,
  dark: readonly [number, number, number],
  light: readonly [number, number, number],
): void {
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < field.length; i++) {
    const t = field[i]!;
    img.data[i * 4] = Math.round(dark[0] + (light[0] - dark[0]) * t);
    img.data[i * 4 + 1] = Math.round(dark[1] + (light[1] - dark[1]) * t);
    img.data[i * 4 + 2] = Math.round(dark[2] + (light[2] - dark[2]) * t);
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

/** Sparse dark blotches (oil stains, scuffs) — drawn over the base fill. */
function paintStains(ctx: Ctx, size: number, rng: () => number, count: number, alpha: number) {
  for (let i = 0; i < count; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const r = 12 + rng() * 46;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(12, 12, 14, ${alpha * (0.5 + rng() * 0.5)})`);
    g.addColorStop(1, 'rgba(12, 12, 14, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

/** Faint cracks: short seeded random walks. */
function paintCracks(ctx: Ctx, size: number, rng: () => number, count: number) {
  ctx.strokeStyle = 'rgba(20, 20, 22, 0.35)';
  ctx.lineWidth = 1;
  for (let i = 0; i < count; i++) {
    let x = rng() * size;
    let y = rng() * size;
    let angle = rng() * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    const steps = 8 + Math.floor(rng() * 14);
    for (let s = 0; s < steps; s++) {
      angle += (rng() - 0.5) * 1.2;
      x += Math.cos(angle) * (4 + rng() * 8);
      y += Math.sin(angle) * (4 + rng() * 8);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

function paintSeams(ctx: Ctx, size: number, spacing: number, vertical: boolean, alpha: number) {
  ctx.fillStyle = `rgba(10, 10, 12, ${alpha})`;
  for (let p = 0; p < size; p += spacing) {
    if (vertical) ctx.fillRect(p, 0, 2, size);
    else ctx.fillRect(0, p, size, 2);
  }
}

// ── Surface recipes ──────────────────────────────────────────────────────────

interface SurfaceRecipe {
  albedo(scene: Scene, seed: number): DynamicTexture;
  normal(scene: Scene, seed: number): DynamicTexture;
  metallic: number;
  roughness: number;
}

const RECIPES: Record<SurfaceKind, SurfaceRecipe> = {
  concrete: {
    albedo: (scene, seed) =>
      makeTexture(scene, 'tex-concrete', (ctx, size) => {
        const rng = mulberry32(seed);
        paintNoise(ctx, size, fbm(rng, size, 128, 4), [118, 118, 122], [158, 158, 164]);
        paintStains(ctx, size, rng, 26, 0.16);
        paintCracks(ctx, size, rng, 10);
        paintSeams(ctx, size, size / 2, true, 0.18); // expansion joints
        paintSeams(ctx, size, size / 2, false, 0.18);
      }),
    normal: (scene, seed) =>
      makeNormalTexture(scene, 'nrm-concrete', fbm(mulberry32(seed ^ 0x9e37), TEX_SIZE, 32, 4), 1.6),
    metallic: 0.02,
    roughness: 0.92,
  },
  paintedWall: {
    albedo: (scene, seed) =>
      makeTexture(scene, 'tex-painted', (ctx, size) => {
        const rng = mulberry32(seed);
        paintNoise(ctx, size, fbm(rng, size, 96, 3), [148, 152, 158], [172, 176, 183]);
        paintStains(ctx, size, rng, 12, 0.1);
        paintSeams(ctx, size, size / 4, true, 0.22); // wall panel joints
        // bolt heads along the panel seams
        ctx.fillStyle = 'rgba(30, 30, 34, 0.5)';
        for (let x = 0; x < size; x += size / 4) {
          for (let y = size / 16; y < size; y += size / 8) ctx.fillRect(x + 5, y, 3, 3);
        }
      }),
    normal: (scene, seed) =>
      makeNormalTexture(scene, 'nrm-painted', fbm(mulberry32(seed ^ 0x9e37), TEX_SIZE, 48, 3), 0.9),
    metallic: 0.08,
    roughness: 0.72,
  },
  metal: {
    albedo: (scene, seed) =>
      makeTexture(scene, 'tex-metal', (ctx, size) => {
        const rng = mulberry32(seed);
        // brushed look: noise stretched horizontally
        const grain = valueNoise(rng, size, 4);
        const bands = valueNoise(rng, size, 64);
        const img = ctx.createImageData(size, size);
        for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) {
            const t = grain[y * size + ((x * 7) % size)]! * 0.35 + bands[y * size + x]! * 0.65;
            const v = 96 + t * 44;
            const i = (y * size + x) * 4;
            img.data[i] = v;
            img.data[i + 1] = v + 4;
            img.data[i + 2] = v + 9;
            img.data[i + 3] = 255;
          }
        }
        ctx.putImageData(img, 0, 0);
        paintSeams(ctx, size, size / 4, false, 0.3);
        paintStains(ctx, size, rng, 8, 0.12);
      }),
    normal: (scene, seed) =>
      makeNormalTexture(scene, 'nrm-metal', fbm(mulberry32(seed ^ 0x9e37), TEX_SIZE, 64, 2), 0.5),
    metallic: 0.3,
    roughness: 0.55,
  },
  wood: {
    albedo: (scene, seed) =>
      makeTexture(scene, 'tex-wood', (ctx, size) => {
        const rng = mulberry32(seed);
        const grain = fbm(rng, size, 64, 3);
        const img = ctx.createImageData(size, size);
        const plank = size / 8;
        for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) {
            const p = Math.floor(x / plank);
            const shade = 0.82 + ((p * 2654435761) % 100) / 500; // per-plank variance
            const g = grain[y * size + ((x * 3) % size)]!;
            const i = (y * size + x) * 4;
            img.data[i] = (128 + g * 46) * shade;
            img.data[i + 1] = (88 + g * 34) * shade;
            img.data[i + 2] = (52 + g * 22) * shade;
            img.data[i + 3] = 255;
          }
        }
        ctx.putImageData(img, 0, 0);
        paintSeams(ctx, size, plank, true, 0.4);
        paintStains(ctx, size, rng, 10, 0.1);
      }),
    normal: (scene, seed) =>
      makeNormalTexture(scene, 'nrm-wood', fbm(mulberry32(seed ^ 0x9e37), TEX_SIZE, 24, 3), 0.8),
    metallic: 0.0,
    roughness: 0.8,
  },
  brick: {
    albedo: (scene, seed) =>
      makeTexture(scene, 'tex-brick', (ctx, size) => {
        const rng = mulberry32(seed);
        paintNoise(ctx, size, fbm(rng, size, 64, 3), [128, 130, 134], [150, 152, 156]); // mortar
        const rowH = size / 8;
        const brickW = size / 4;
        for (let row = 0; row < 8; row++) {
          const offset = row % 2 === 0 ? 0 : brickW / 2;
          for (let col = -1; col < 5; col++) {
            const bx = col * brickW + offset;
            const by = row * rowH;
            const shade = 0.85 + rng() * 0.3;
            ctx.fillStyle = `rgb(${Math.round(142 * shade)}, ${Math.round(74 * shade)}, ${Math.round(58 * shade)})`;
            ctx.fillRect(bx + 3, by + 3, brickW - 6, rowH - 6);
          }
        }
        paintStains(ctx, size, rng, 14, 0.14);
      }),
    normal: (scene, seed) =>
      makeNormalTexture(scene, 'nrm-brick', fbm(mulberry32(seed ^ 0x9e37), TEX_SIZE, 40, 3), 1.2),
    metallic: 0.0,
    roughness: 0.9,
  },
};

// ── World-space UVs ──────────────────────────────────────────────────────────

/**
 * Rescale a mesh's UVs so its textures tile once per `metersPerTile`, per face.
 * Works on any mesh built from quads with per-face 0-1 UVs (boxes, grounds):
 * for each 4-vertex face, the constant axis is detected and UVs are scaled by
 * the face's world extents. This gives uniform texel density with ONE shared
 * material — no per-mesh material clones.
 */
export function applyWorldUVs(mesh: Mesh, metersPerTile: number): void {
  const pos = mesh.getVerticesData(VertexBuffer.PositionKind);
  const uv = mesh.getVerticesData(VertexBuffer.UVKind);
  if (!pos || !uv) return;
  const scaled = new Float32Array(uv.length);
  for (let f = 0; f + 3 < pos.length / 3; f += 4) {
    // face extents on each axis
    const ext = [0, 1, 2].map((axis) => {
      let min = Infinity;
      let max = -Infinity;
      for (let v = f; v < f + 4; v++) {
        const c = pos[v * 3 + axis]!;
        if (c < min) min = c;
        if (c > max) max = c;
      }
      return max - min;
    });
    // the two largest extents are the face plane's U/V spans
    const sorted = [...ext].sort((a, b) => b - a);
    const su = Math.max(sorted[0]! / metersPerTile, 0.01);
    const sv = Math.max(sorted[1]! / metersPerTile, 0.01);
    for (let v = f; v < f + 4; v++) {
      scaled[v * 2] = uv[v * 2]! * su;
      scaled[v * 2 + 1] = uv[v * 2 + 1]! * sv;
    }
  }
  mesh.setVerticesData(VertexBuffer.UVKind, scaled);
}

// ── Library ──────────────────────────────────────────────────────────────────

const SEED = 0x48_69_64_65; // "Hide" — fixed so every client generates identical art

/** Per-scene cache of procedural materials. Scene disposal frees everything. */
export class MaterialLibrary {
  private readonly cache = new Map<string, PBRMaterial>();

  constructor(private readonly scene: Scene) {}

  /** Shared PBR material for a surface family (tileable; pair with applyWorldUVs). */
  surface(kind: SurfaceKind): PBRMaterial {
    let mat = this.cache.get(kind);
    if (mat) return mat;
    const recipe = RECIPES[kind];
    mat = new PBRMaterial(`srf-${kind}`, this.scene);
    mat.albedoTexture = recipe.albedo(this.scene, SEED);
    mat.bumpTexture = recipe.normal(this.scene, SEED);
    mat.metallic = recipe.metallic;
    mat.roughness = recipe.roughness;
    mat.maxSimultaneousLights = MAX_LIGHTS;
    mat.enableSpecularAntiAliasing = true;
    this.cache.set(kind, mat);
    return mat;
  }

  /** The one material ALL props share: near-white grunge × vertex-color tints. */
  propShared(): PBRMaterial {
    let mat = this.cache.get('prop-shared');
    if (mat) return mat;
    mat = new PBRMaterial('prop-shared', this.scene);
    mat.albedoTexture = makeTexture(this.scene, 'tex-grunge', (ctx, size) => {
      const rng = mulberry32(SEED ^ 0x5eed);
      paintNoise(ctx, size, fbm(rng, size, 64, 3), [212, 210, 206], [238, 237, 235]);
      paintStains(ctx, size, rng, 16, 0.08);
    });
    mat.bumpTexture = makeNormalTexture(
      this.scene,
      'nrm-grunge',
      fbm(mulberry32(SEED ^ 0xbeef), TEX_SIZE, 48, 3),
      0.55,
    );
    mat.metallic = 0.06;
    mat.roughness = 0.78;
    mat.maxSimultaneousLights = MAX_LIGHTS;
    mat.enableSpecularAntiAliasing = true;
    this.cache.set('prop-shared', mat);
    return mat;
  }

  /** Bright "daylight through glass" pane — emissive, unlit, cheap. */
  glassPane(): StandardMaterial {
    const existing = this.scene.getMaterialByName('win-glass');
    if (existing) return existing as StandardMaterial;
    const mat = new StandardMaterial('win-glass', this.scene);
    mat.emissiveColor = new Color3(0.85, 0.92, 1.0);
    mat.disableLighting = true;
    return mat;
  }

  /** Warm emissive disc for light fixtures. */
  lampEmissive(): StandardMaterial {
    const existing = this.scene.getMaterialByName('lamp-glow');
    if (existing) return existing as StandardMaterial;
    const mat = new StandardMaterial('lamp-glow', this.scene);
    mat.emissiveColor = new Color3(1.0, 0.9, 0.72);
    mat.disableLighting = true;
    return mat;
  }
}
