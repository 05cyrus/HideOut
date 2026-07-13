/**
 * Procedural low-poly prop archetypes.
 *
 * Every prop is composed from primitives, colored via VERTEX COLORS, and merged
 * into a single mesh with one shared material — so each archetype is exactly one
 * draw call and instances/clones stay cheap. No external art assets: the whole
 * game ships procedurally, which keeps the PWA payload tiny and fully offline.
 */
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Scene } from '@babylonjs/core/scene';
import { PropType } from '../../game/types';

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

function merge(scene: Scene, name: string, parts: Mesh[]): Mesh {
  const merged = Mesh.MergeMeshes(parts, true, true);
  if (!merged) throw new Error(`failed to merge prop mesh "${name}"`);
  merged.name = name;
  let mat = scene.getMaterialByName('prop-shared') as StandardMaterial | null;
  if (!mat) {
    mat = new StandardMaterial('prop-shared', scene);
    mat.diffuseColor = Color3.White();
    mat.specularColor = new Color3(0.05, 0.05, 0.05);
  }
  merged.material = mat;
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

type Builder = (scene: Scene) => Mesh;

const builders: Record<Exclude<PropType, PropType.None>, Builder> = {
  [PropType.Crate]: (s) =>
    merge(s, 'prop-crate', [
      tint(box(s, 1.05, 0.95, 1.05, 0, 0.475, 0), WOOD),
      tint(box(s, 1.12, 0.1, 1.12, 0, 0.95, 0), WOOD_DARK),
      tint(box(s, 1.12, 0.1, 1.12, 0, 0.05, 0), WOOD_DARK),
    ]),
  [PropType.Barrel]: (s) =>
    merge(s, 'prop-barrel', [
      tint(cyl(s, 0.72, 0.95, 0, 0.475, 0), METAL),
      tint(cyl(s, 0.76, 0.08, 0, 0.2, 0), METAL_DARK),
      tint(cyl(s, 0.76, 0.08, 0, 0.75, 0), METAL_DARK),
    ]),
  [PropType.Plant]: (s) =>
    merge(s, 'prop-plant', [
      tint(cyl(s, 0.42, 0.35, 0, 0.175, 0, 8), TERRACOTTA),
      tint(cyl(s, 0.65, 0.85, 0, 0.85, 0, 6), GREEN), // stylized cone-ish bush
    ]),
  [PropType.Chair]: (s) =>
    merge(s, 'prop-chair', [
      tint(box(s, 0.45, 0.07, 0.45, 0, 0.45, 0), WOOD),
      tint(box(s, 0.45, 0.5, 0.07, 0, 0.73, -0.19), WOOD),
      tint(box(s, 0.06, 0.45, 0.06, -0.18, 0.225, -0.18), WOOD_DARK),
      tint(box(s, 0.06, 0.45, 0.06, 0.18, 0.225, -0.18), WOOD_DARK),
      tint(box(s, 0.06, 0.45, 0.06, -0.18, 0.225, 0.18), WOOD_DARK),
      tint(box(s, 0.06, 0.45, 0.06, 0.18, 0.225, 0.18), WOOD_DARK),
    ]),
  [PropType.Table]: (s) =>
    merge(s, 'prop-table', [
      tint(box(s, 1.4, 0.08, 0.85, 0, 0.75, 0), WOOD),
      tint(box(s, 0.08, 0.72, 0.08, -0.62, 0.36, -0.35), WOOD_DARK),
      tint(box(s, 0.08, 0.72, 0.08, 0.62, 0.36, -0.35), WOOD_DARK),
      tint(box(s, 0.08, 0.72, 0.08, -0.62, 0.36, 0.35), WOOD_DARK),
      tint(box(s, 0.08, 0.72, 0.08, 0.62, 0.36, 0.35), WOOD_DARK),
    ]),
  [PropType.Lamp]: (s) =>
    merge(s, 'prop-lamp', [
      tint(cyl(s, 0.34, 0.06, 0, 0.03, 0, 10), METAL_DARK),
      tint(cyl(s, 0.07, 1.5, 0, 0.78, 0, 8), METAL_DARK),
      tint(cyl(s, 0.45, 0.35, 0, 1.62, 0, 8), FABRIC),
    ]),
  [PropType.Shelf]: (s) =>
    merge(s, 'prop-shelf', [
      tint(box(s, 0.08, 2.0, 0.5, -0.86, 1.0, 0), METAL_DARK),
      tint(box(s, 0.08, 2.0, 0.5, 0.86, 1.0, 0), METAL_DARK),
      tint(box(s, 1.8, 0.06, 0.5, 0, 0.4, 0), WOOD),
      tint(box(s, 1.8, 0.06, 0.5, 0, 1.05, 0), WOOD),
      tint(box(s, 1.8, 0.06, 0.5, 0, 1.7, 0), WOOD),
    ]),
  [PropType.TrashCan]: (s) =>
    merge(s, 'prop-trashcan', [
      tint(cyl(s, 0.5, 0.78, 0, 0.39, 0, 10), BIN_GREEN),
      tint(cyl(s, 0.56, 0.07, 0, 0.8, 0, 10), METAL_DARK),
    ]),
};

/** Build all archetype templates once per scene. Key = PropType. */
export function buildPropTemplates(scene: Scene): Map<PropType, Mesh> {
  const templates = new Map<PropType, Mesh>();
  for (const [key, build] of Object.entries(builders)) {
    templates.set(Number(key) as PropType, build(scene));
  }
  return templates;
}
