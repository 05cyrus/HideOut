/**
 * HideOut — A 3D multiplayer prop-hunt game
 * Copyright (c) 2026 Sumit Gusain
 * Licensed under the MIT License - see LICENSE file for details
 *
 * Non-possessable set-dressing meshes (forklift, dumpster, hanging industrial
 * lamps, catwalks). Render-only: decorations never enter the simulation or the
 * wire protocol — walls/pillars that must block movement are map COLLIDERS.
 *
 * Same construction discipline as props: primitives + vertex tints merged into
 * one mesh on the shared grunge PBR material (1 draw call per decoration).
 */
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import type { Scene } from '@babylonjs/core/scene';
import type { DecorationPlacement } from '../../game/maps/types';
import type { MaterialLibrary } from './materials';
import { merge, tint } from './propMeshes';

const FORK_YELLOW = new Color3(0.93, 0.62, 0.1);
const DARK_METAL = new Color3(0.24, 0.27, 0.32);
const TIRE = new Color3(0.12, 0.12, 0.14);
const DUMPSTER_GREEN = new Color3(0.22, 0.38, 0.28);
const SAFETY_YELLOW = new Color3(0.85, 0.7, 0.15);
const SHADE_GREEN = new Color3(0.2, 0.3, 0.26);

const box = (s: Scene, w: number, h: number, d: number, x: number, y: number, z: number) => {
  const m = CreateBox('d', { width: w, height: h, depth: d }, s);
  m.position.set(x, y, z);
  return m;
};

const wheel = (s: Scene, dia: number, w: number, x: number, y: number, z: number) => {
  const m = CreateCylinder('d', { diameter: dia, height: w, tessellation: 10 }, s);
  m.rotation.z = Math.PI / 2; // axle along X
  m.position.set(x, y, z);
  m.convertToFlatShadedMesh();
  return m;
};

function forklift(s: Scene, mats: MaterialLibrary): Mesh {
  return merge('deco-forklift', mats, [
    tint(box(s, 1.05, 0.55, 1.6, 0, 0.62, -0.15), FORK_YELLOW), // chassis
    tint(box(s, 0.95, 0.35, 0.5, 0, 1.0, -0.75), DARK_METAL), // counterweight
    tint(box(s, 0.5, 0.12, 0.45, 0, 0.96, 0.0), TIRE), // seat base
    tint(box(s, 0.5, 0.4, 0.1, 0, 1.2, -0.22), TIRE), // seat back
    // overhead guard
    tint(box(s, 0.06, 1.1, 0.06, -0.48, 1.45, 0.45), DARK_METAL),
    tint(box(s, 0.06, 1.1, 0.06, 0.48, 1.45, 0.45), DARK_METAL),
    tint(box(s, 0.06, 1.1, 0.06, -0.48, 1.45, -0.55), DARK_METAL),
    tint(box(s, 0.06, 1.1, 0.06, 0.48, 1.45, -0.55), DARK_METAL),
    tint(box(s, 1.1, 0.06, 1.2, 0, 2.02, -0.05), FORK_YELLOW), // roof
    // mast rails + crossbars
    tint(box(s, 0.09, 2.1, 0.09, -0.32, 1.05, 0.78), DARK_METAL),
    tint(box(s, 0.09, 2.1, 0.09, 0.32, 1.05, 0.78), DARK_METAL),
    tint(box(s, 0.75, 0.08, 0.08, 0, 1.95, 0.78), DARK_METAL),
    tint(box(s, 0.75, 0.08, 0.08, 0, 0.6, 0.78), DARK_METAL),
    // forks
    tint(box(s, 0.14, 0.05, 1.05, -0.25, 0.06, 1.35), DARK_METAL),
    tint(box(s, 0.14, 0.05, 1.05, 0.25, 0.06, 1.35), DARK_METAL),
    // wheels
    tint(wheel(s, 0.52, 0.22, -0.55, 0.26, 0.45), TIRE),
    tint(wheel(s, 0.52, 0.22, 0.55, 0.26, 0.45), TIRE),
    tint(wheel(s, 0.44, 0.2, -0.52, 0.22, -0.62), TIRE),
    tint(wheel(s, 0.44, 0.2, 0.52, 0.22, -0.62), TIRE),
  ]);
}

function dumpster(s: Scene, mats: MaterialLibrary): Mesh {
  const lid = tint(box(s, 1.9, 0.06, 1.12, 0, 1.32, -0.06), DUMPSTER_GREEN);
  lid.rotation.x = -0.12;
  return merge('deco-dumpster', mats, [
    tint(box(s, 1.9, 1.05, 1.1, 0, 0.72, 0), DUMPSTER_GREEN),
    lid,
    // side ribs
    tint(box(s, 0.06, 0.9, 1.16, -0.6, 0.7, 0), DUMPSTER_GREEN),
    tint(box(s, 0.06, 0.9, 1.16, 0.6, 0.7, 0), DUMPSTER_GREEN),
    // feet + front pocket
    tint(box(s, 1.7, 0.2, 0.9, 0, 0.1, 0), DARK_METAL),
    tint(box(s, 0.5, 0.25, 0.08, 0, 0.5, 0.58), DARK_METAL),
  ]);
}

/** Hanging industrial fixture. The warm glow disc is a separate emissive mesh;
 * the actual light comes from the map theme's pointLights (data-aligned). */
function ceilingLamp(s: Scene, mats: MaterialLibrary, wallHeight: number): Mesh {
  const headY = wallHeight - 1.1;
  const rodLen = 1.1;
  const fixture = merge('deco-lamp', mats, [
    tint(cylUp(s, 0.05, rodLen, 0, headY + rodLen / 2, 0), DARK_METAL),
    tint(cylUp(s, 0.72, 0.3, 0, headY, 0, true), SHADE_GREEN),
  ]);
  const glow = CreateCylinder('lamp-glow-disc', { diameter: 0.5, height: 0.03 }, s);
  glow.position.set(0, headY - 0.16, 0);
  glow.material = mats.lampEmissive();
  glow.parent = fixture;
  return fixture;
}

function cylUp(
  s: Scene,
  dia: number,
  h: number,
  x: number,
  y: number,
  z: number,
  cone = false,
): Mesh {
  const m = CreateCylinder(
    'd',
    { diameterTop: cone ? dia * 0.45 : dia, diameterBottom: dia, height: h, tessellation: 12 },
    s,
  );
  m.position.set(x, y, z);
  m.convertToFlatShadedMesh();
  return m;
}

/** Wall-mounted catwalk platform, ABOVE head height — pure verticality dressing
 * (not climbable; catwalks have railings, per the map plan). Length stretches
 * parametrically with `scale` so posts/railings never distort. */
function catwalk(s: Scene, mats: MaterialLibrary, scale: number): Mesh {
  const length = 6 * scale;
  const deckY = 3.0;
  const parts: Mesh[] = [
    tint(box(s, length, 0.08, 1.3, 0, deckY, 0), DARK_METAL), // deck
    tint(box(s, length, 0.16, 0.04, 0, deckY + 0.1, 0.65), SAFETY_YELLOW), // kick plate
    tint(box(s, length, 0.05, 0.05, 0, deckY + 1.05, 0.65), DARK_METAL), // top rail
    tint(box(s, length, 0.04, 0.04, 0, deckY + 0.6, 0.65), DARK_METAL), // mid rail
  ];
  const posts = Math.max(2, Math.round(length / 1.5) + 1);
  for (let i = 0; i < posts; i++) {
    const px = -length / 2 + (length / (posts - 1)) * i;
    parts.push(tint(box(s, 0.05, 1.05, 0.05, px, deckY + 0.55, 0.65), DARK_METAL)); // rail post
  }
  const supports = Math.max(2, Math.round(length / 3) + 1);
  for (let i = 0; i < supports; i++) {
    const px = -length / 2 + (length / (supports - 1)) * i;
    parts.push(tint(box(s, 0.09, deckY, 0.09, px, deckY / 2, -0.55), DARK_METAL)); // leg to floor
  }
  return merge('deco-catwalk', mats, parts);
}

/** Instantiate every decoration in the map. Returns the created meshes so the
 * renderer can register shadow casters. */
export function buildDecorations(
  scene: Scene,
  mats: MaterialLibrary,
  decorations: readonly DecorationPlacement[],
  wallHeight: number,
): Mesh[] {
  const meshes: Mesh[] = [];
  for (const d of decorations) {
    let mesh: Mesh;
    switch (d.type) {
      case 'forklift':
        mesh = forklift(scene, mats);
        break;
      case 'dumpster':
        mesh = dumpster(scene, mats);
        break;
      case 'ceilingLamp':
        mesh = ceilingLamp(scene, mats, wallHeight);
        break;
      case 'catwalk':
        mesh = catwalk(scene, mats, d.scale ?? 1);
        break;
    }
    mesh.setEnabled(true); // merge() disables templates; decorations show directly
    mesh.position.set(d.x, 0, d.z);
    mesh.rotation.y = d.yaw;
    mesh.freezeWorldMatrix();
    meshes.push(mesh);
  }
  return meshes;
}
