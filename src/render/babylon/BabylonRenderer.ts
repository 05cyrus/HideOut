/**
 * HideOut — A 3D multiplayer prop-hunt game
 * Copyright (c) 2026 Sumit Gusain
 * Licensed under the MIT License - see LICENSE file for details
 *
 * Babylon.js implementation of IRenderer: first-person scene, procedural map
 * geometry with PBR materials (all textures generated at init — zero assets),
 * data-driven map themes (fog, industrial point-light pools, windows, ceiling
 * trusses, decorations), real-time shadows, ACES tone mapping, prop instances,
 * player avatars with disguise swapping, and an adaptive quality tuner.
 *
 * Deep imports keep the bundle to what we actually use. Note the side-effect
 * imports: `instancedMesh` patches `Mesh.createInstance` (static prop
 * placement), `shadowGeneratorSceneComponent` registers the shadow pipeline.
 */
import '@babylonjs/core/Meshes/instancedMesh';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { TargetCamera } from '@babylonjs/core/Cameras/targetCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import { CreateCapsule } from '@babylonjs/core/Meshes/Builders/capsuleBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { PropType, type EntityRecord } from '../../game/types';
import type { MapDef, SurfaceKind } from '../../game/maps/types';
import { raycastWalls, type AABB, type CollisionWorld } from '../../game/physics';
import type { CameraPose, CameraView, IRenderer, QualityPreset } from '../IRenderer';
import { buildPropTemplates } from './propMeshes';
import { buildDecorations } from './decorationMeshes';
import { applyWorldUVs, MaterialLibrary, MAX_LIGHTS } from './materials';

const EYE_HEIGHT = 1.6;

// Third-person follow camera (view-only): sits behind + above the player looking
// forward with a slight downward tilt, pulled in when a wall is close behind.
const TP_DISTANCE = 4.2;
const TP_HEIGHT = 1.1; // above eye height
const TP_PITCH_BIAS = 0.12; // radians, tilt down toward the player
const TP_MIN_DISTANCE = 0.8;
const TP_WALL_MARGIN = 0.3;

/** Texture tiling densities (meters per tile). */
const FLOOR_TILE = 4;
const WALL_TILE = 3;

/** Noise-ping (visual taunt) tuning. NOTE: callers pass a SCATTERED position
 * (see render/tauntScatter.ts) — the cue marks a search area, never the hider. */
const PING_POOL = 6; // concurrent taunts on screen (staggered → rarely all lit)
const PING_DURATION_MS = 1800;
const PING_MAX_SCALE = 5; // ring grows from ~0.7 m to ~3.5 m radius
const PING_BEAM_HEIGHT = 4;
const PING_COLOR: readonly [number, number, number] = [0.45, 0.9, 1.0]; // "sound" cyan

interface NoisePing {
  ring: Mesh;
  beam: Mesh;
  start: number;
}

const PLAYER_PALETTE = [
  new Color3(0.9, 0.49, 0.13),
  new Color3(0.2, 0.6, 0.86),
  new Color3(0.61, 0.35, 0.71),
  new Color3(0.18, 0.8, 0.44),
  new Color3(0.95, 0.77, 0.06),
  new Color3(0.91, 0.3, 0.24),
  new Color3(0.1, 0.74, 0.61),
  new Color3(0.75, 0.75, 0.78),
  new Color3(0.9, 0.4, 0.6),
  new Color3(0.5, 0.55, 0.9),
  new Color3(0.6, 0.8, 0.3),
  new Color3(0.8, 0.6, 0.4),
];

interface Avatar {
  root: TransformNode;
  capsule: Mesh;
  disguise: Mesh | null;
  disguiseType: PropType;
}

/** Four wall slabs just outside the bounds (render + TP-camera blocking). */
function perimeterRims(b: AABB, t = 0.4): AABB[] {
  return [
    { minX: b.minX - t, minZ: b.minZ - t, maxX: b.maxX + t, maxZ: b.minZ },
    { minX: b.minX - t, minZ: b.maxZ, maxX: b.maxX + t, maxZ: b.maxZ + t },
    { minX: b.minX - t, minZ: b.minZ, maxX: b.minX, maxZ: b.maxZ },
    { minX: b.maxX, minZ: b.minZ, maxX: b.maxX + t, maxZ: b.maxZ },
  ];
}

export class BabylonRenderer implements IRenderer {
  private engine: Engine | null = null;
  private scene: Scene | null = null;
  private camera: TargetCamera | null = null;
  private mats: MaterialLibrary | null = null;
  private templates: Map<PropType, Mesh> = new Map();
  private avatars = new Map<number, Avatar>();
  private localNetId = -1;
  private attackFlash: Mesh | null = null;
  private attackFlashUntil = 0;
  private noisePings: NoisePing[] = [];
  private nextPing = 0;
  private preset: QualityPreset = 'auto';
  private autoFrames = 0;
  private cameraView: CameraView = 'first';
  private collision: CollisionWorld | null = null;
  private shadows: ShadowGenerator | null = null;
  private sun: DirectionalLight | null = null;
  private fixtureLights: PointLight[] = [];

  async init(canvas: HTMLCanvasElement, map: MapDef, localNetId: number): Promise<void> {
    this.localNetId = localNetId;
    // The third-person camera raycasts this world; include the perimeter rims so
    // the follow camera can never back out through the outer walls (the sim
    // handles the perimeter via bounds-clamping instead, so rims are render-only).
    this.collision = {
      bounds: map.bounds,
      colliders: [...map.colliders, ...perimeterRims(map.bounds)],
    };
    const engine = new Engine(canvas, true, {
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.engine = engine;

    const scene = new Scene(engine);
    this.scene = scene;
    this.mats = new MaterialLibrary(scene);
    const theme = map.theme;

    const clear = theme?.clearColor ?? [0.05, 0.07, 0.1];
    scene.clearColor = new Color4(clear[0], clear[1], clear[2], 1);
    scene.ambientColor = new Color3(0.3, 0.3, 0.35);

    // Filmic response scene-wide (applies to Standard AND PBR materials).
    const ip = scene.imageProcessingConfiguration;
    ip.toneMappingEnabled = true;
    ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    ip.exposure = 1.15;
    ip.contrast = 1.15;
    ip.vignetteEnabled = true;
    ip.vignetteWeight = 1.4;

    if (theme?.fogDensity) {
      scene.fogMode = Scene.FOGMODE_EXP2;
      scene.fogDensity = theme.fogDensity;
      const fc = theme.fogColor ?? clear;
      scene.fogColor = new Color3(fc[0], fc[1], fc[2]);
    }

    // ── Lights ──
    const hemi = new HemisphericLight('hemi', new Vector3(0.2, 1, 0.1), scene);
    hemi.intensity = theme?.ambientIntensity ?? 0.7;
    hemi.groundColor = new Color3(0.25, 0.24, 0.28);

    const sd = theme?.sunDirection ?? [-0.4, -1, 0.35];
    const sunDir = new Vector3(sd[0], sd[1], sd[2]).normalize();
    const sun = new DirectionalLight('sun', sunDir, scene);
    sun.intensity = theme?.sunIntensity ?? 1.5;
    sun.position = sunDir.scale(-60);
    this.sun = sun;

    // One shadow map, driven by the key light. Poisson sampling stays WebGL1-safe
    // (headless SwiftShader in e2e), soft enough for the industrial look.
    const shadows = new ShadowGenerator(1024, sun);
    shadows.usePoissonSampling = true;
    shadows.bias = 0.001;
    this.shadows = shadows;

    for (const pl of theme?.pointLights ?? []) {
      const light = new PointLight(`fixture-${this.fixtureLights.length}`, new Vector3(pl.x, pl.y, pl.z), scene);
      light.intensity = pl.intensity;
      if (pl.range !== undefined) light.range = pl.range;
      const c = pl.color ?? [1, 0.9, 0.75];
      light.diffuse = new Color3(c[0], c[1], c[2]);
      light.shadowEnabled = false; // only the key light casts
      this.fixtureLights.push(light);
    }

    this.camera = new TargetCamera('fp', new Vector3(0, EYE_HEIGHT, 0), scene);
    this.camera.minZ = 0.05;
    this.camera.fov = 1.1;
    scene.activeCamera = this.camera;

    this.buildEnvironment(scene, map);
    this.templates = buildPropTemplates(scene, this.mats);
    this.placeStaticProps(map);
    this.buildAttackFlash(scene);
    this.buildNoisePings(scene);
    this.applyPresetEffects();
  }

  // ── Per-frame API ────────────────────────────────────────────────────────

  syncViews(views: readonly EntityRecord[]): void {
    if (!this.scene) return;
    const seen = new Set<number>();

    for (const view of views) {
      seen.add(view.netId);
      let avatar = this.avatars.get(view.netId);
      if (!avatar) {
        avatar = this.createAvatar(view.netId);
        this.avatars.set(view.netId, avatar);
      }

      // The local player's own body is hidden in first-person, shown in third.
      const isLocal = view.netId === this.localNetId;
      const visible = view.alive && (!isLocal || this.cameraView === 'third');
      avatar.root.setEnabled(visible);
      if (!visible) continue;

      avatar.root.position.x = view.x;
      avatar.root.position.z = view.z;
      avatar.root.rotation.y = view.yaw;

      if (view.propType !== avatar.disguiseType) this.applyDisguise(avatar, view.propType);
    }

    // Remove avatars for players that vanished from the views (left the game).
    for (const [netId, avatar] of this.avatars) {
      if (!seen.has(netId)) {
        this.shadows?.removeShadowCaster(avatar.capsule);
        if (avatar.disguise) this.shadows?.removeShadowCaster(avatar.disguise);
        avatar.root.dispose();
        this.avatars.delete(netId);
      }
    }
  }

  setCamera(pose: CameraPose): void {
    if (!this.camera) return;
    if (this.cameraView === 'third') {
      const fwdX = Math.sin(pose.yaw);
      const fwdZ = Math.cos(pose.yaw);
      let dist = TP_DISTANCE;
      // Pull the camera in if a wall is close behind, so it never clips through.
      if (this.collision) {
        const wall = raycastWalls(pose.x, pose.z, -fwdX, -fwdZ, this.collision);
        if (wall < dist + TP_WALL_MARGIN) dist = Math.max(TP_MIN_DISTANCE, wall - TP_WALL_MARGIN);
      }
      this.camera.position.set(pose.x - fwdX * dist, EYE_HEIGHT + TP_HEIGHT, pose.z - fwdZ * dist);
      this.camera.rotation.set(pose.pitch + TP_PITCH_BIAS, pose.yaw, 0);
    } else {
      this.camera.position.set(pose.x, EYE_HEIGHT, pose.z);
      this.camera.rotation.set(pose.pitch, pose.yaw, 0);
    }
  }

  setCameraView(view: CameraView): void {
    this.cameraView = view;
  }

  flashAttack(): void {
    this.attackFlashUntil = performance.now() + 110;
  }

  pingNoise(x: number, z: number): void {
    if (this.noisePings.length === 0) return;
    const ping = this.noisePings[this.nextPing]!;
    this.nextPing = (this.nextPing + 1) % this.noisePings.length;
    ping.ring.position.set(x, 0.05, z);
    ping.beam.position.set(x, PING_BEAM_HEIGHT / 2, z);
    ping.start = performance.now();
    ping.ring.setEnabled(true);
    ping.beam.setEnabled(true);
  }

  render(): void {
    if (!this.engine || !this.scene) return;
    const now = performance.now();
    if (this.attackFlash) {
      this.attackFlash.setEnabled(now < this.attackFlashUntil);
    }
    this.animateNoisePings(now);
    this.scene.render();
    if (this.preset === 'auto') this.autoTune();
  }

  resize(): void {
    this.engine?.resize();
  }

  setQuality(preset: QualityPreset): void {
    this.preset = preset;
    if (!this.engine) return;
    const scale = preset === 'high' ? 1 : preset === 'medium' ? 1.35 : preset === 'low' ? 1.75 : 1;
    this.engine.setHardwareScalingLevel(scale);
    this.applyPresetEffects();
  }

  fps(): number {
    return this.engine ? Math.round(this.engine.getFps()) : 0;
  }

  dispose(): void {
    this.scene?.dispose();
    this.engine?.dispose();
    this.scene = null;
    this.engine = null;
    this.mats = null;
    this.shadows = null;
    this.sun = null;
    this.fixtureLights = [];
    this.noisePings = [];
    this.nextPing = 0;
    this.avatars.clear();
    this.templates.clear();
  }

  // ── Scene construction ───────────────────────────────────────────────────

  private buildEnvironment(scene: Scene, map: MapDef): void {
    const mats = this.mats!;
    const theme = map.theme;
    const width = map.bounds.maxX - map.bounds.minX;
    const depth = map.bounds.maxZ - map.bounds.minZ;
    const cx = (map.bounds.minX + map.bounds.maxX) / 2;
    const cz = (map.bounds.minZ + map.bounds.maxZ) / 2;

    const floor = CreateGround('floor', { width, height: depth }, scene);
    floor.position.set(cx, 0, cz);
    applyWorldUVs(floor, FLOOR_TILE);
    floor.material = mats.surface(theme?.floor ?? 'concrete');
    floor.receiveShadows = true;
    floor.freezeWorldMatrix();

    const wallSurface = theme?.walls ?? 'paintedWall';
    const h = map.wallHeight;

    // Interior colliders as solid boxes (per-collider height/surface overrides).
    map.colliders.forEach((c, i) => {
      this.wallBox(
        scene,
        `wall${i}`,
        c,
        map.colliderHeights?.[i] ?? h,
        map.colliderSurfaces?.[i] ?? wallSurface,
      );
    });

    // Perimeter walls just outside the bounds.
    const b = map.bounds;
    perimeterRims(b).forEach((c, i) => this.wallBox(scene, `rim${i}`, c, h, wallSurface));

    // Themed maps are fully indoor: ceiling deck + steel trusses close the hall.
    if (theme) {
      const ceiling = CreateBox('ceiling', { width, height: 0.3, depth }, scene);
      ceiling.position.set(cx, h + 0.15, cz);
      applyWorldUVs(ceiling, FLOOR_TILE);
      ceiling.material = mats.surface('metal');
      ceiling.freezeWorldMatrix();

      const trussMat = mats.surface('metal');
      for (let z = Math.ceil(b.minZ / 8) * 8; z < b.maxZ; z += 8) {
        const beam = CreateBox(`truss-${z}`, { width, height: 0.4, depth: 0.28 }, scene);
        beam.position.set(cx, h - 0.2, z);
        applyWorldUVs(beam, WALL_TILE);
        beam.material = trussMat;
        beam.freezeWorldMatrix();
      }

      for (const w of map.windows ?? []) this.buildWindow(scene, w.x, w.z, w.yaw, w.width, w.sill, w.height);

      const decos = buildDecorations(scene, mats, map.decorations ?? [], h);
      for (const mesh of decos) {
        mesh.receiveShadows = true;
        this.shadows?.addShadowCaster(mesh);
      }
    }
  }

  private wallBox(scene: Scene, name: string, c: AABB, height: number, surface: SurfaceKind): void {
    const mesh = CreateBox(name, { width: c.maxX - c.minX, height, depth: c.maxZ - c.minZ }, scene);
    mesh.position.set((c.minX + c.maxX) / 2, height / 2, (c.minZ + c.maxZ) / 2);
    applyWorldUVs(mesh, WALL_TILE);
    mesh.material = this.mats!.surface(surface);
    mesh.receiveShadows = true;
    this.shadows?.addShadowCaster(mesh);
    mesh.freezeWorldMatrix();
  }

  /** Emissive "daylight" pane + dark frame, flush against a wall face. */
  private buildWindow(scene: Scene, x: number, z: number, yaw: number, width: number, sill: number, height: number): void {
    const mats = this.mats!;
    const frame = CreateBox('win-frame', { width: width + 0.24, height: height + 0.24, depth: 0.08 }, scene);
    frame.position.set(x, sill + height / 2, z);
    frame.rotation.y = yaw;
    frame.material = mats.surface('metal');
    frame.freezeWorldMatrix();

    const pane = CreateBox('win-pane', { width, height, depth: 0.1 }, scene);
    pane.position.set(x, sill + height / 2, z);
    pane.rotation.y = yaw;
    pane.material = mats.glassPane();
    pane.freezeWorldMatrix();
  }

  private placeStaticProps(map: MapDef): void {
    for (const prop of map.props) {
      const template = this.templates.get(prop.type);
      if (!template) continue;
      const instance = template.createInstance(`prop-${prop.id}`);
      instance.position.set(prop.x, 0, prop.z);
      instance.rotation.y = prop.yaw;
      instance.freezeWorldMatrix();
      this.shadows?.addShadowCaster(instance);
    }
  }

  private createAvatar(netId: number): Avatar {
    const scene = this.scene!;
    const root = new TransformNode(`player-${netId}`, scene);
    const capsule = CreateCapsule(`cap-${netId}`, { height: 1.7, radius: 0.34 }, scene);
    capsule.parent = root;
    capsule.position.y = 0.85;
    const mat = new StandardMaterial(`pmat-${netId}`, scene);
    mat.diffuseColor = PLAYER_PALETTE[netId % PLAYER_PALETTE.length]!;
    mat.specularColor = new Color3(0.1, 0.1, 0.1);
    mat.maxSimultaneousLights = MAX_LIGHTS;
    capsule.material = mat;
    this.shadows?.addShadowCaster(capsule);
    return { root, capsule, disguise: null, disguiseType: PropType.None };
  }

  private applyDisguise(avatar: Avatar, propType: PropType): void {
    if (avatar.disguise) this.shadows?.removeShadowCaster(avatar.disguise);
    avatar.disguise?.dispose();
    avatar.disguise = null;
    avatar.disguiseType = propType;

    if (propType === PropType.None) {
      avatar.capsule.setEnabled(true);
      return;
    }
    const template = this.templates.get(propType);
    if (!template) return;
    const clone = template.clone(`disguise-${avatar.root.name}`);
    clone.setEnabled(true);
    clone.parent = avatar.root;
    clone.position.set(0, 0, 0);
    avatar.disguise = clone;
    this.shadows?.addShadowCaster(clone);
    avatar.capsule.setEnabled(false);
  }

  private buildAttackFlash(scene: Scene): void {
    // A small emissive sphere pinned in front of the camera; toggled on attack.
    // PBR-unlit for the same reason as the ping material (see buildNoisePings).
    const flash = CreateSphere('attack-flash', { diameter: 0.08, segments: 6 }, scene);
    const mat = new PBRMaterial('flash-mat', scene);
    mat.unlit = true;
    mat.emissiveColor = new Color3(1, 0.85, 0.4);
    flash.material = mat;
    flash.parent = this.camera;
    flash.position.set(0.15, -0.12, 0.6);
    flash.setEnabled(false);
    this.attackFlash = flash;
    mat.forceCompilation(flash); // pre-warm — see buildNoisePings
  }

  /** Pre-build the noise-ping pool: an expanding ground ring + a tall beam per
   * slot, reused round-robin so a taunt costs zero allocation. Depth-tested, so
   * walls occlude the beam (a hider in the next room isn't given away). */
  private buildNoisePings(scene: Scene): void {
    // One shared OPAQUE unlit-emissive material. Deliberately PBR: every other
    // mesh in the scene renders through the PBR pipeline, so its shader variants
    // are proven under our tree-shaken deep imports. (A StandardMaterial with
    // disableLighting never reached isReady() in non-themed scenes — no compile
    // error surfaced, the mesh just silently never drew.) Scale-based animation,
    // so no alpha blending is ever needed.
    const mat = new PBRMaterial('ping-mat', scene);
    mat.unlit = true;
    mat.emissiveColor = new Color3(PING_COLOR[0], PING_COLOR[1], PING_COLOR[2]);

    for (let i = 0; i < PING_POOL; i++) {
      // Torus lies flat in XZ (hole axis = Y) → a ground ring. Sized so the
      // fully-grown ring (~6.6 m radius) covers the whole scatter search area.
      const ring = CreateTorus(`ping-ring-${i}`, { diameter: 2.2, thickness: 0.24, tessellation: 32 }, scene);
      ring.material = mat;
      ring.isPickable = false;
      ring.setEnabled(false);

      const beam = CreateCylinder(`ping-beam-${i}`, { diameter: 0.5, height: PING_BEAM_HEIGHT, tessellation: 16 }, scene);
      beam.material = mat;
      beam.isPickable = false;
      beam.setEnabled(false);

      this.noisePings.push({ ring, beam, start: 0 });
    }

    // Pre-warm the shader NOW: this unlit-emissive variant is used by nothing
    // else in the scene, and lazy compilation can outlive a 1.5 s ping on slow
    // devices (software GL in e2e) — the cue would silently never draw.
    mat.forceCompilation(this.noisePings[0]!.ring);
  }

  private animateNoisePings(now: number): void {
    for (const p of this.noisePings) {
      if (!p.ring.isEnabled()) continue;
      const age = (now - p.start) / PING_DURATION_MS;
      if (age >= 1) {
        p.ring.setEnabled(false);
        p.beam.setEnabled(false);
        continue;
      }
      const fade = 1 - age;
      const scale = 1 + age * PING_MAX_SCALE;
      // Ring sweeps outward and thins; beam tapers away — all scale, no alpha.
      p.ring.scaling.set(scale, 1 * fade + 0.2, scale);
      p.beam.scaling.set(fade, 1, fade);
    }
  }

  // ── Quality ──────────────────────────────────────────────────────────────

  /** 'low' sheds the expensive extras: shadows off, only the nearest fixture
   * pools stay lit. Resolution scaling is handled in setQuality/autoTune. */
  private applyPresetEffects(): void {
    const low = this.preset === 'low';
    if (this.sun) this.sun.shadowEnabled = !low;
    this.fixtureLights.forEach((light, i) => light.setEnabled(!low || i < 3));
  }

  // ── Adaptive quality (auto preset) ───────────────────────────────────────

  private autoTune(): void {
    if (!this.engine) return;
    if (++this.autoFrames % 120 !== 0) return; // evaluate every ~2 s
    const fps = this.engine.getFps();
    const scale = this.engine.getHardwareScalingLevel();
    if (fps < 50 && scale < 2.0) {
      this.engine.setHardwareScalingLevel(Math.min(2.0, scale + 0.25));
    } else if (fps > 58 && scale > 1.0) {
      this.engine.setHardwareScalingLevel(Math.max(1.0, scale - 0.25));
    }
  }
}
