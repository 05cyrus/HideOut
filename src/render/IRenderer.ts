/**
 * Renderer contract. The game/net layers never import Babylon — they hand the
 * renderer plain view records each frame. Swapping engines (or adding a
 * headless null-renderer for bots) means implementing this interface only.
 */
import type { EntityRecord } from '../game/types';
import type { MapDef } from '../game/maps/types';

export type QualityPreset = 'auto' | 'high' | 'medium' | 'low';

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
  /** First-person camera pose (predicted local player). */
  setCamera(pose: CameraPose): void;
  /** Brief muzzle-flash/swing feedback at the hunter's position. */
  flashAttack(): void;
  render(): void;
  resize(): void;
  setQuality(preset: QualityPreset): void;
  /** Current smoothed FPS (for the HUD/debug). */
  fps(): number;
  dispose(): void;
}
