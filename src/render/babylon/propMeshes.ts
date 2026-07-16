/**
 * Procedural low-poly prop archetypes.
 *
 * Every prop is composed from primitives, colored via VERTEX COLORS, and merged
 * into a single mesh with one shared material — so each archetype is exactly one
 * draw call and instances/clones stay cheap. No external art assets: the whole
 * game ships procedurally, which keeps the PWA payload tiny and fully offline.
 *
 * The shared material is the library's grunge PBR (near-white albedo texture ×
 * vertex tints), so props pick up roughness/bump detail without losing the
 * one-material instancing guarantee.
 */
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import type { Scene } from '@babylonjs/core/scene';
import { PropType } from '../../game/types';
import type { MaterialLibrary } from './materials';

/** Paint every vertex of a mesh with one color (alpha 1). */
export function tint(mesh: Mesh, color: Color3): Mesh {
  const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
  if (!positions) return mesh;
  const count = positions.length / 3;
  const colors = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    colors[i * 4] = color.r;
    colors[i * 4 + 1] = color.g;
    colors[i * 4 + 2] = color.b;
    colors[i * 4 + 3] = 1;
  }
  mesh.setVerticesData(VertexBuffer.ColorKind, colors);
  return mesh;
}

export function merge(name: string, mats: MaterialLibrary, parts: Mesh[]): Mesh {
  const merged = Mesh.MergeMeshes(parts, true, true);
  if (!merged) throw new Error(`failed to merge prop mesh "${name}"`);
  merged.name = name;
  merged.material = mats.propShared();
  merged.isPickable = false;
  merged.setEnabled(false); // templates stay hidden; clones/instances show
  return merged;
}

const box = (scene: Scene, w: number, h: number, d: number, x: number, y: number, z: number) => {
  const m = CreateBox('b', { width: w, height: h, depth: d }, scene);
  m.position.set(x, y, z);
  return m;
};

const cyl = (scene: Scene, dia: number, h: number, x: number, y: number, z: number, tess = 10) => {
  const m = CreateCylinder('c', { diameter: dia, height: h, tessellation: tess }, scene);
  m.position.set(x, y, z);
  m.convertToFlatShadedMesh(); // low-poly facet look
  return m;
};

const WOOD = new Color3(0.62, 0.44, 0.24);
const WOOD_DARK = new Color3(0.48, 0.33, 0.17);
const METAL = new Color3(0.42, 0.47, 0.55);
const METAL_DARK = new Color3(0.3, 0.34, 0.4);
const GREEN = new Color3(0.32, 0.55, 0.29);
const TERRACOTTA = new Color3(0.71, 0.4, 0.26);
const FABRIC = new Color3(0.75, 0.68, 0.5);
const BIN_GREEN = new Color3(0.29, 0.45, 0.33);
const CARDBOARD = new Color3(0.72, 0.55, 0.36);
const CARDBOARD_DARK = new Color3(0.58, 0.43, 0.26);
const TAPE = new Color3(0.55, 0.4, 0.28);
const CONE_ORANGE = new Color3(0.92, 0.42, 0.12);
const CONE_WHITE = new Color3(0.92, 0.9, 0.86);

type Builder = (scene: Scene, mats: MaterialLibrary) => Mesh;

const builders: Record<Exclude<PropType, PropType.None>, Builder> = {
  [PropType.Crate]: (s, m) =>
    merge('prop-crate', m, [
      tint(box(s, 1.05, 0.95, 1.05, 0, 0.475, 0), WOOD),
      tint(box(s, 1.12, 0.1, 1.12, 0, 0.95, 0), WOOD_DARK),
      tint(box(s, 1.12, 0.1, 1.12, 0, 0.05, 0), WOOD_DARK),
    ]),
  [PropType.Barrel]: (s, m) =>
    merge('prop-barrel', m, [
      tint(cyl(s, 0.72, 0.95, 0, 0.475, 0), METAL),
      tint(cyl(s, 0.76, 0.08, 0, 0.2, 0), METAL_DARK),
      tint(cyl(s, 0.76, 0.08, 0, 0.75, 0), METAL_DARK),
    ]),
  [PropType.Plant]: (s, m) =>
    merge('prop-plant', m, [
      tint(cyl(s, 0.42, 0.35, 0, 0.175, 0, 8), TERRACOTTA),
      tint(cyl(s, 0.65, 0.85, 0, 0.85, 0, 6), GREEN), // stylized cone-ish bush
    ]),
  [PropType.Chair]: (s, m) =>
    merge('prop-chair', m, [
      tint(box(s, 0.45, 0.07, 0.45, 0, 0.45, 0), WOOD),
      tint(box(s, 0.45, 0.5, 0.07, 0, 0.73, -0.19), WOOD),
      tint(box(s, 0.06, 0.45, 0.06, -0.18, 0.225, -0.18), WOOD_DARK),
      tint(box(s, 0.06, 0.45, 0.06, 0.18, 0.225, -0.18), WOOD_DARK),
      tint(box(s, 0.06, 0.45, 0.06, -0.18, 0.225, 0.18), WOOD_DARK),
      tint(box(s, 0.06, 0.45, 0.06, 0.18, 0.225, 0.18), WOOD_DARK),
    ]),
  [PropType.Table]: (s, m) =>
    merge('prop-table', m, [
      tint(box(s, 1.4, 0.08, 0.85, 0, 0.75, 0), WOOD),
      tint(box(s, 0.08, 0.72, 0.08, -0.62, 0.36, -0.35), WOOD_DARK),
      tint(box(s, 0.08, 0.72, 0.08, 0.62, 0.36, -0.35), WOOD_DARK),
      tint(box(s, 0.08, 0.72, 0.08, -0.62, 0.36, 0.35), WOOD_DARK),
      tint(box(s, 0.08, 0.72, 0.08, 0.62, 0.36, 0.35), WOOD_DARK),
    ]),
  [PropType.Lamp]: (s, m) =>
    merge('prop-lamp', m, [
      tint(cyl(s, 0.34, 0.06, 0, 0.03, 0, 10), METAL_DARK),
      tint(cyl(s, 0.07, 1.5, 0, 0.78, 0, 8), METAL_DARK),
      tint(cyl(s, 0.45, 0.35, 0, 1.62, 0, 8), FABRIC),
    ]),
  [PropType.Shelf]: (s, m) =>
    merge('prop-shelf', m, [
      tint(box(s, 0.08, 2.0, 0.5, -0.86, 1.0, 0), METAL_DARK),
      tint(box(s, 0.08, 2.0, 0.5, 0.86, 1.0, 0), METAL_DARK),
      tint(box(s, 1.8, 0.06, 0.5, 0, 0.4, 0), WOOD),
      tint(box(s, 1.8, 0.06, 0.5, 0, 1.05, 0), WOOD),
      tint(box(s, 1.8, 0.06, 0.5, 0, 1.7, 0), WOOD),
    ]),
  [PropType.TrashCan]: (s, m) =>
    merge('prop-trashcan', m, [
      tint(cyl(s, 0.5, 0.78, 0, 0.39, 0, 10), BIN_GREEN),
      tint(cyl(s, 0.56, 0.07, 0, 0.8, 0, 10), METAL_DARK),
    ]),
  [PropType.CardboardBox]: (s, m) => {
    // slightly-open top flaps
    const flapL = tint(box(s, 0.4, 0.02, 0.82, -0.22, 0.72, 0), CARDBOARD_DARK);
    flapL.rotation.z = 0.35;
    const flapR = tint(box(s, 0.4, 0.02, 0.82, 0.22, 0.72, 0), CARDBOARD_DARK);
    flapR.rotation.z = -0.35;
    return merge('prop-cardboard', m, [
      tint(box(s, 0.85, 0.7, 0.85, 0, 0.35, 0), CARDBOARD),
      tint(box(s, 0.87, 0.06, 0.12, 0, 0.35, 0), TAPE), // strapping band
      flapL,
      flapR,
    ]);
  },
  [PropType.Pallet]: (s, m) => {
    // two stacked pallets: 3 skids + deck boards each
    const parts: Mesh[] = [];
    for (let level = 0; level < 2; level++) {
      const y = level * 0.15;
      for (const sx of [-0.5, 0, 0.5]) {
        parts.push(tint(box(s, 0.12, 0.09, 1.1, sx, y + 0.045, 0), WOOD_DARK));
      }
      for (let b = 0; b < 5; b++) {
        parts.push(tint(box(s, 1.2, 0.05, 0.16, 0, y + 0.115, -0.44 + b * 0.22), WOOD));
      }
    }
    return merge('prop-pallet', m, parts);
  },
  [PropType.Cone]: (s, m) => {
    const body = CreateCylinder(
      'c',
      { diameterTop: 0.07, diameterBottom: 0.34, height: 0.68, tessellation: 12 },
      s,
    );
    body.position.set(0, 0.39, 0);
    body.convertToFlatShadedMesh();
    const band = CreateCylinder(
      'c',
      { diameterTop: 0.17, diameterBottom: 0.24, height: 0.16, tessellation: 12 },
      s,
    );
    band.position.set(0, 0.48, 0);
    band.convertToFlatShadedMesh();
    return merge('prop-cone', m, [
      tint(box(s, 0.44, 0.05, 0.44, 0, 0.025, 0), CONE_ORANGE),
      tint(body, CONE_ORANGE),
      tint(band, CONE_WHITE),
    ]);
  },
  [PropType.Spool]: (s, m) =>
    merge('prop-spool', m, [
      tint(cyl(s, 1.0, 0.09, 0, 0.045, 0, 14), WOOD),
      tint(cyl(s, 0.55, 0.78, 0, 0.48, 0, 12), METAL_DARK), // wound cable drum
      tint(cyl(s, 1.0, 0.09, 0, 0.92, 0, 14), WOOD),
    ]),
};

/** Build all archetype templates once per scene. Key = PropType. */
export function buildPropTemplates(scene: Scene, mats: MaterialLibrary): Map<PropType, Mesh> {
  const templates = new Map<PropType, Mesh>();
  for (const [key, build] of Object.entries(builders)) {
    templates.set(Number(key) as PropType, build(scene, mats));
  }
  return templates;
}
