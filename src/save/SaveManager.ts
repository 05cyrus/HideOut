/**
 * Persistent local state (IndexedDB via `idb`): profile + settings.
 * No accounts, no cloud — everything stays on-device, per the offline design.
 */
import { openDB, type IDBPDatabase } from 'idb';
import type { CameraView, QualityPreset } from '../render/IRenderer';

export interface Settings {
  playerName: string;
  sensitivity: number;
  quality: QualityPreset;
  volume: number;
  cameraView: CameraView;
}

const DEFAULTS: Settings = {
  playerName: '',
  sensitivity: 1,
  quality: 'auto',
  volume: 0.8,
  cameraView: 'first',
};

const DB_NAME = 'hideout';
const STORE = 'kv';

export class SaveManager {
  private constructor(private readonly db: IDBPDatabase) {}

  static async open(): Promise<SaveManager> {
    const db = await openDB(DB_NAME, 1, {
      upgrade(db) {
        db.createObjectStore(STORE);
      },
    });
    return new SaveManager(db);
  }

  async getSettings(): Promise<Settings> {
    const stored = (await this.db.get(STORE, 'settings')) as Partial<Settings> | undefined;
    return { ...DEFAULTS, ...stored };
  }

  async saveSettings(patch: Partial<Settings>): Promise<Settings> {
    const next = { ...(await this.getSettings()), ...patch };
    await this.db.put(STORE, next, 'settings');
    return next;
  }
}
