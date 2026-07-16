/**
 * Renderer contract. The game/net layers never import Babylon — they hand the
 * renderer plain view records each frame. Swapping engines (or adding a
 * headless null-renderer for bots) means implementing this interface only.
 */
import type { EntityRecord } from '../game/types';
import type { MapDef } from '../game/maps/types';

export type QualityPreset = 'auto' | 'high' | 'medium' | 'low';

/** First-person (eye-level) or third-person (follow) camera. View-only — it has
 * no effect on simulation, networking, or authority. */
export type CameraView = 'first' | 'third';

export interface CameraPose {
  x: number;
  z: number;
  yaw: number;
  pitch: number;
}

export interface IRenderer {
  init(canvas: HTMLCanvasElement, map: MapDef, localNetId: number): Promise<void>;
  /** Upsert every player's visual state for this frame. */
  syncViews(views: readonly EntityRecord[]): void;
  /** Camera pose (predicted local player); positioned per the current view mode. */
  setCamera(pose: CameraPose): void;
  /** Switch between first- and third-person. Also toggles whether the local
   * player's own body/disguise is rendered. */
  setCameraView(view: CameraView): void;
  /** Brief muzzle-flash/swing feedback at the hunter's position. */
  flashAttack(): void;
  render(): void;
  resize(): void;
  setQuality(preset: QualityPreset): void;
  /** Current smoothed FPS (for the HUD/debug). */
  fps(): number;
  dispose(): void;
}
