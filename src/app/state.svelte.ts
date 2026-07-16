/**
 * HideOut — A 3D multiplayer prop-hunt game
 * Copyright (c) 2026 Sumit Gusain
 * Licensed under the MIT License - see LICENSE file for details
 *
 * UI-facing reactive state (Svelte 5 runes). This is a READ MODEL: the
 * GameFacade writes to it from engine/net events; screens only read (and call
 * facade methods to act). Hot game state (positions) never passes through
 * here — it flows engine→renderer directly.
 */
import type { RosterEntry } from '../net/protocol/events';
import { GamePhase, type Role } from '../game/types';
import type { Settings } from '../save/SaveManager';
import type { Capabilities } from '../platform/capabilities';
import type { CameraView } from '../render/IRenderer';

export type Screen = 'menu' | 'host' | 'join' | 'lobby' | 'game';

export interface HudState {
  role: Role;
  alive: boolean;
  disguised: boolean;
  locked: boolean;
  health: number;
  swapsLeft: number;
  rttMs: number;
  fps: number;
}

export interface RoundResult {
  winner: 'hunter' | 'hiders';
  survivorNames: string[];
  localWon: boolean;
}

class AppState {
  screen = $state<Screen>('menu');
  capabilities = $state<Capabilities | null>(null);
  settings = $state<Settings | null>(null);

  /** Current camera view (first/third person) — for the in-game VIEW button label. */
  cameraView = $state<CameraView>('first');

  /** Lobby/session */
  roomName = $state('');
  isHost = $state(false);
  roster = $state<RosterEntry[]>([]);
  localNetId = $state(-1);

  /** Round */
  phase = $state<GamePhase>(GamePhase.Waiting);
  secondsLeft = $state(-1);
  hunterName = $state('');
  killFeed = $state<string[]>([]);
  lastResult = $state<RoundResult | null>(null);

  hud = $state<HudState>({
    role: 'hider',
    alive: true,
    disguised: false,
    locked: false,
    health: 255,
    swapsLeft: 0,
    rttMs: 0,
    fps: 0,
  });

  errorMessage = $state('');

  pushKill(line: string): void {
    this.killFeed = [...this.killFeed.slice(-3), line];
  }
}

export const app = new AppState();
