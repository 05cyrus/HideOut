/**
 * Babylon.js implementation of IRenderer: first-person scene, procedural map
 * geometry, prop instances, player avatars with disguise swapping, and an
 * adaptive quality tuner (render-resolution scaling driven by measured FPS).
 *
 * Deep imports keep the bundle to what we actually use. Note the side-effect
 * import of `instancedMesh` — it patches `Mesh.createInstance`, which the
 * static prop placement relies on.
 */
import '@babylonjs/core/Meshes/instancedMesh';
import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { TargetCamera } from '@babylonjs/core/Cameras/targetCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import { CreateCapsule } from '@babylonjs/core/Meshes/Builders/capsuleBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { PropType, type EntityRecord } from '../../game/types';
import type { MapDef } from '../../game/maps/types';
import { raycastWalls, type AABB, type CollisionWorld } from '../../game/physics';
import type { CameraPose, CameraView, IRenderer, QualityPreset } from '../IRenderer';
import { buildPropTemplates, tint } from './propMeshes';

const EYE_HEIGHT = 1.6;

// Third-person follow camera (view-only): sits behind + above the player looking
// forward with a slight downward tilt, pulled in when a wall is close behind.
const TP_DISTANCE = 4.2;
const TP_HEIGHT = 1.1; // above eye height
const TP_PITCH_BIAS = 0.12; // radians, tilt down toward the player
const TP_MIN_DISTANCE = 0.8;
const TP_WALL_MARGIN = 0.3;

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

export class BabylonRenderer implements IRenderer {
  private engine: Engine | null = null;
  private scene: Scene | null = null;
  private camera: TargetCamera | null = null;
  private templates: Map<PropType, Mesh> = new Map();
  private avatars = new Map<number, Avatar>();
  private localNetId = -1;
  private attackFlash: Mesh | null = null;
  private attackFlashUntil = 0;
  private preset: QualityPreset = 'auto';
  private autoFrames = 0;
  private cameraView: CameraView = 'first';
  private collision: CollisionWorld | null = null;

  async init(canvas: HTMLCanvasElement, map: MapDef, localNetId: number): Promise<void> {
    this.localNetId = localNetId;
    this.collision = { bounds: map.bounds, colliders: map.colliders };
    const engine = new Engine(canvas, true, {
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.engine = engine;

    const scene = new Scene(engine);
    this.scene = scene;
    scene.clearColor = new Color4(0.05, 0.07, 0.1, 1);
    scene.ambientColor = new Color3(0.3, 0.3, 0.35);

    const hemi = new HemisphericLight('hemi', new Vector3(0.2, 1, 0.1), scene);
    hemi.intensity = 0.85;
    hemi.groundColor = new Color3(0.25, 0.24, 0.28);
    const dir = new DirectionalLight('dir', new Vector3(-0.4, -1, 0.35), scene);
    dir.intensity = 0.5;

    this.camera = new TargetCamera('fp', new Vector3(0, EYE_HEIGHT, 0), scene);
    this.camera.minZ = 0.05;
    this.camera.fov = 1.1;
    scene.activeCamera = this.camera;

    this.buildEnvironment(scene, map);
    this.templates = buildPropTemplates(scene);
    this.placeStaticProps(map);
    this.buildAttackFlash(scene);
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

  render(): void {
    if (!this.engine || !this.scene) return;
    if (this.attackFlash) {
      this.attackFlash.setEnabled(performance.now() < this.attackFlashUntil);
    }
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
  }

  fps(): number {
    return this.engine ? Math.round(this.engine.getFps()) : 0;
  }

  dispose(): void {
    this.scene?.dispose();
    this.engine?.dispose();
    this.scene = null;
    this.engine = null;
    this.avatars.clear();
    this.templates.clear();
  }

  // ── Scene construction ───────────────────────────────────────────────────

  private buildEnvironment(scene: Scene, map: MapDef): void {
    const width = map.bounds.maxX - map.bounds.minX;
    const depth = map.bounds.maxZ - map.bounds.minZ;
    const cx = (map.bounds.minX + map.bounds.maxX) / 2;
    const cz = (map.bounds.minZ + map.bounds.maxZ) / 2;

    const floor = CreateGround('floor', { width, height: depth }, scene);
    floor.position.set(cx, 0, cz);
    tint(floor, new Color3(0.32, 0.33, 0.36));
    floor.material = this.sharedMat(scene);
    floor.freezeWorldMatrix();

    const wallColor = new Color3(0.45, 0.44, 0.5);
    const h = map.wallHeight;

    // Interior colliders as solid boxes.
    map.colliders.forEach((c, i) => this.wallBox(scene, `wall${i}`, c, h, wallColor));

    // Perimeter walls just outside the bounds.
    const t = 0.4;
    const b = map.bounds;
    const rims: AABB[] = [
      { minX: b.minX - t, minZ: b.minZ - t, maxX: b.maxX + t, maxZ: b.minZ },
      { minX: b.minX - t, minZ: b.maxZ, maxX: b.maxX + t, maxZ: b.maxZ + t },
      { minX: b.minX - t, minZ: b.minZ, maxX: b.minX, maxZ: b.maxZ },
      { minX: b.maxX, minZ: b.minZ, maxX: b.maxX + t, maxZ: b.maxZ },
    ];
    rims.forEach((c, i) => this.wallBox(scene, `rim${i}`, c, h, wallColor));
  }

  private wallBox(scene: Scene, name: string, c: AABB, height: number, color: Color3): void {
    const mesh = CreateBox(name, { width: c.maxX - c.minX, height, depth: c.maxZ - c.minZ }, scene);
    mesh.position.set((c.minX + c.maxX) / 2, height / 2, (c.minZ + c.maxZ) / 2);
    tint(mesh, color);
    mesh.material = this.sharedMat(scene);
    mesh.freezeWorldMatrix();
  }

  private placeStaticProps(map: MapDef): void {
    for (const prop of map.props) {
      const template = this.templates.get(prop.type);
      if (!template) continue;
      const instance = template.createInstance(`prop-${prop.id}`);
      instance.position.set(prop.x, 0, prop.z);
      instance.rotation.y = prop.yaw;
      instance.freezeWorldMatrix();
    }
  }

  private sharedMat(scene: Scene): StandardMaterial {
    let mat = scene.getMaterialByName('world-shared') as StandardMaterial | null;
    if (!mat) {
      mat = new StandardMaterial('world-shared', scene);
      mat.diffuseColor = Color3.White();
      mat.specularColor = new Color3(0.03, 0.03, 0.03);
    }
    return mat;
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
    capsule.material = mat;
    return { root, capsule, disguise: null, disguiseType: PropType.None };
  }

  private applyDisguise(avatar: Avatar, propType: PropType): void {
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
    avatar.capsule.setEnabled(false);
  }

  private buildAttackFlash(scene: Scene): void {
    // A small emissive sphere pinned in front of the camera; toggled on attack.
    const flash = CreateSphere('attack-flash', { diameter: 0.08, segments: 6 }, scene);
    const mat = new StandardMaterial('flash-mat', scene);
    mat.emissiveColor = new Color3(1, 0.85, 0.4);
    mat.disableLighting = true;
    flash.material = mat;
    flash.parent = this.camera;
    flash.position.set(0.15, -0.12, 0.6);
    flash.setEnabled(false);
    this.attackFlash = flash;
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
