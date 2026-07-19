/**
 * Minimal repro for the invisible noise-ping mesh (debug harness, not shipped).
 * Mirrors BabylonRenderer's scene setup piece by piece so we can bisect which
 * ingredient makes the unlit ping meshes skip rendering. Served by `vite` at
 * /tests/e2e/ping-repro.html.
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
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateCapsule } from '@babylonjs/core/Meshes/Builders/capsuleBuilder';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { MaterialLibrary, applyWorldUVs } from '../../src/render/babylon/materials';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const engine = new Engine(canvas, true, { powerPreference: 'high-performance', stencil: false });
const scene = new Scene(engine);

// Same image processing as the game.
const ip = scene.imageProcessingConfiguration;
ip.toneMappingEnabled = true;
ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
ip.exposure = 1.15;
ip.contrast = 1.15;
ip.vignetteEnabled = true;
ip.vignetteWeight = 1.4;

scene.clearColor = new Color4(0.05, 0.07, 0.1, 1);
scene.ambientColor = new Color3(0.3, 0.3, 0.35);

const hemi = new HemisphericLight('hemi', new Vector3(0.2, 1, 0.1), scene);
hemi.intensity = 0.7;
const sun = new DirectionalLight('sun', new Vector3(-0.4, -1, 0.35).normalize(), scene);
sun.intensity = 1.5;
const shadows = new ShadowGenerator(1024, sun);
shadows.usePoissonSampling = true;

const camera = new TargetCamera('fp', new Vector3(0, 2.7, -4.2), scene);
camera.minZ = 0.05;
camera.fov = 1.1;
camera.rotation.set(0.12, 0, 0);
scene.activeCamera = camera;

// PBR floor via the real MaterialLibrary (same as the game).
const mats = new MaterialLibrary(scene);
const floor = CreateGround('floor', { width: 30, height: 30 }, scene);
applyWorldUVs(floor, 4);
floor.material = mats.surface('concrete');
floor.receiveShadows = true;

// A reference capsule (this always rendered in the game).
const capsule = CreateCapsule('cap', { height: 1.7, radius: 0.34 }, scene);
capsule.position.y = 0.85;
const capMat = new StandardMaterial('capmat', scene);
capMat.diffuseColor = new Color3(0.2, 0.6, 0.86);
capsule.material = capMat;

// The EXACT ping recipe from BabylonRenderer.
const pingMat = new PBRMaterial('ping-mat', scene);
pingMat.unlit = true;
pingMat.emissiveColor = new Color3(0.45, 0.9, 1.0);

const ring = CreateTorus('ring', { diameter: 1.4, thickness: 0.16, tessellation: 28 }, scene);
ring.material = pingMat;
ring.isPickable = false;
ring.setEnabled(false);

const beam = CreateCylinder('beam', { diameter: 0.5, height: 5, tessellation: 16 }, scene);
beam.material = pingMat;
beam.isPickable = false;
beam.setEnabled(false);

pingMat.forceCompilation(ring);

// "pingNoise": position + enable, exactly like the game.
function ping(x: number, z: number): void {
  ring.position.set(x, 0.05, z);
  beam.position.set(x, 2.5, z);
  ring.setEnabled(true);
  beam.setEnabled(true);
  ring.scaling.set(2, 1, 2); // mid-animation size, frozen
  beam.scaling.set(0.8, 1, 0.8);
}

let frames = 0;
engine.runRenderLoop(() => {
  scene.render();
  if (++frames === 30) ping(0, 0); // enable after the scene is warm
  (window as unknown as { __state?: unknown }).__state = {
    frames,
    ringEnabled: ring.isEnabled(),
    ringReady: ring.isReady(true),
    matReady: pingMat.isReady(ring),
    active: scene.getActiveMeshes().length,
  };
});
