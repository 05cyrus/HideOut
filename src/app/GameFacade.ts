/**
 * HideOut — A 3D multiplayer prop-hunt game
 * Copyright (c) 2026 Sumit Gusain
 * Licensed under the MIT License - see LICENSE file for details
 *
 * Composition root + orchestration. Owns the managers (input, audio, save),
 * the active session, and the render loop; translates session events into UI
 * state (app.*) and audio/FX. Screens call facade methods; they never touch
 * net/render internals directly.
 *
 * Loop architecture: requestAnimationFrame drives a FixedTimestep accumulator.
 * Each fixed step (30 Hz): sample input → submit to session (predict/simulate)
 * → session.fixedTick(). Each frame: interpolate remotes, sync views to the
 * renderer, pose the camera from the predicted local state, render.
 */
import { FixedTimestep } from '../core/time';
import type { Unsubscribe } from '../core/events';
import { GamePhase, PropType, type SimEvent } from '../game/types';
import { defaultConfig } from '../game/config';
import { warehouseMap, maps } from '../game/maps/warehouse';
import type { GameSession } from '../net/session/types';
import { HostSession } from '../net/session/HostSession';
import { ClientSession } from '../net/session/ClientSession';
import type { PeerLink } from '../net/transport/PeerLink';
import { InputManager } from '../input/InputManager';
import { AudioManager } from '../audio/AudioManager';
import { SaveManager } from '../save/SaveManager';
import type { CameraView, IRenderer } from '../render/IRenderer';
import { app } from './state.svelte';

const IDLE_TICK_MS = 1000 / defaultConfig.tickRate;

export class GameFacade {
  readonly input = new InputManager();
  readonly audio = new AudioManager();
  private save: SaveManager | null = null;

  private session: GameSession | null = null;
  private renderer: IRenderer | null = null;
  private readonly fixed = new FixedTimestep({ step: 1 / defaultConfig.tickRate });
  private seq = 0;
  private rafHandle = 0;
  private lastFrameTime = 0;
  private idleTimer: ReturnType<typeof setInterval> | null = null;
  private unsubs: Unsubscribe[] = [];
  private resizeHandler = () => this.renderer?.resize();
  private cameraView: CameraView = 'first';

  // ── Boot ──────────────────────────────────────────────────────────────────

  async init(): Promise<void> {
    try {
      this.save = await SaveManager.open();
      app.settings = await this.save.getSettings();
      this.input.sensitivity = app.settings.sensitivity;
      this.audio.setVolume(app.settings.volume);
    } catch {
      app.settings = {
        playerName: '',
        sensitivity: 1,
        quality: 'auto',
        volume: 0.8,
        cameraView: 'first',
      };
    }
  }

  /** Flip first/third-person (view-only). Persisted so it's remembered next match. */
  toggleCameraView(): void {
    this.cameraView = this.cameraView === 'first' ? 'third' : 'first';
    this.renderer?.setCameraView(this.cameraView);
    app.cameraView = this.cameraView;
    void this.updateSettings({ cameraView: this.cameraView });
  }

  async updateSettings(patch: Partial<NonNullable<typeof app.settings>>): Promise<void> {
    if (this.save) app.settings = await this.save.saveSettings(patch);
    else if (app.settings) app.settings = { ...app.settings, ...patch };
    if (app.settings) {
      this.input.sensitivity = app.settings.sensitivity;
      this.audio.setVolume(app.settings.volume);
      this.renderer?.setQuality(app.settings.quality);
    }
  }

  playerName(): string {
    return app.settings?.playerName?.trim() || 'Player';
  }

  // ── Session lifecycle ─────────────────────────────────────────────────────

  hostGame(roomName: string): void {
    this.teardownSession();
    const host = new HostSession({
      roomName: roomName.trim() || 'HideOut Room',
      hostName: this.playerName(),
      map: warehouseMap,
      config: defaultConfig,
    });
    this.session = host;
    app.isHost = true;
    app.roomName = roomName;
    app.localNetId = host.localNetId;
    app.roster = host.roster();
    this.wireSession(host);
    this.startIdleTicking();
    app.screen = 'lobby';
  }

  /** Host: hand a newly-opened invite link to the session. */
  attachPeer(link: PeerLink): void {
    if (this.session instanceof HostSession) this.session.attachPeer(link);
  }

  /** Joiner: adopt an opened link to the host; resolves once welcomed. */
  joinGame(link: PeerLink): void {
    this.teardownSession();
    const client = new ClientSession(link, this.playerName(), maps, defaultConfig);
    this.session = client;
    app.isHost = false;
    this.wireSession(client);
    this.startIdleTicking();
    // Screen switches on 'connected'; a rejected/failed link raises 'disconnected'.
  }

  setReady(ready: boolean): void {
    this.session?.setReady(ready);
    if (this.session) app.roster = this.session.roster();
  }

  startRound(): boolean {
    return this.session?.startRound() ?? false;
  }

  leaveGame(): void {
    this.teardownSession();
    app.screen = 'menu';
  }

  currentSession(): GameSession | null {
    return this.session;
  }

  // ── In-match loop ─────────────────────────────────────────────────────────

  /** Enter the 3D scene (GameScreen mount). */
  async startMatch(canvas: HTMLCanvasElement, container: HTMLElement): Promise<void> {
    if (!this.session) return;
    this.stopIdleTicking();

    // Renderer is created lazily so menu/lobby never pay for Babylon.
    const { BabylonRenderer } = await import('../render/babylon/BabylonRenderer');
    this.renderer = new BabylonRenderer();
    const map = maps[this.session.mapId] ?? warehouseMap;
    await this.renderer.init(canvas, map, this.session.localNetId);
    this.renderer.setQuality(app.settings?.quality ?? 'auto');
    this.cameraView = app.settings?.cameraView ?? 'first';
    this.renderer.setCameraView(this.cameraView);
    app.cameraView = this.cameraView;

    this.input.onViewToggle = () => this.toggleCameraView();
    this.input.attach(container);
    window.addEventListener('resize', this.resizeHandler);

    this.fixed.reset();
    this.lastFrameTime = performance.now();
    const loop = (t: number) => {
      this.rafHandle = requestAnimationFrame(loop);
      const dt = Math.min(0.25, (t - this.lastFrameTime) / 1000);
      this.lastFrameTime = t;
      this.tickFrame(dt);
    };
    this.rafHandle = requestAnimationFrame(loop);
  }

  /** Leave the 3D scene (GameScreen unmount). */
  stopMatch(): void {
    cancelAnimationFrame(this.rafHandle);
    this.rafHandle = 0;
    window.removeEventListener('resize', this.resizeHandler);
    this.input.onViewToggle = null;
    this.input.detach();
    this.renderer?.dispose();
    this.renderer = null;
    if (this.session) this.startIdleTicking();
  }

  private tickFrame(dt: number): void {
    const session = this.session;
    if (!session) return;

    // Freeze look while the local hider is locked in place — a real static prop
    // neither moves nor turns. This holds the camera AND the networked yaw steady
    // (movement is already frozen by resolveSpeed), so the prop stops spinning for
    // everyone. Unlocking resumes look from the held angle with no jump.
    this.input.lookEnabled = !(session.localState()?.record.locked ?? false);

    const steps = this.fixed.advance(dt);
    for (let i = 0; i < steps; i++) {
      session.submitLocalInput(this.input.sample(this.seq++));
      session.fixedTick();
    }

    session.frame(dt);

    if (this.renderer) {
      this.renderer.syncViews(session.views());
      const local = session.localState();
      if (local) {
        this.renderer.setCamera({
          x: local.record.x,
          z: local.record.z,
          yaw: this.input.yaw,
          pitch: this.input.pitch,
        });
      }
      this.renderer.render();
    }

    this.syncHud();
  }

  private syncHud(): void {
    const session = this.session;
    if (!session) return;
    const info = session.phaseInfo();
    app.phase = info.phase;
    app.secondsLeft = info.secondsLeft;

    const local = session.localState();
    if (local) {
      app.hud = {
        role: local.record.role,
        alive: local.record.alive,
        disguised: local.record.propType !== PropType.None,
        locked: local.record.locked,
        health: local.record.health,
        swapsLeft: local.swapsLeft,
        rttMs: Math.round(session.rttMs()),
        fps: this.renderer?.fps() ?? 0,
      };
    }
  }

  // ── Idle ticking (lobby: sim/pings continue without rendering) ───────────

  private startIdleTicking(): void {
    this.stopIdleTicking();
    this.idleTimer = setInterval(() => this.session?.fixedTick(), IDLE_TICK_MS);
  }

  private stopIdleTicking(): void {
    if (this.idleTimer !== null) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }
  }

  // ── Session events → UI/audio ─────────────────────────────────────────────

  private wireSession(session: GameSession): void {
    this.unwire();

    this.unsubs.push(
      session.events.on('roster', (roster) => {
        app.roster = roster;
      }),

      session.events.on('connected', ({ netId }) => {
        app.localNetId = netId;
        app.roster = session.roster();
        app.screen = 'lobby';
      }),

      session.events.on('disconnected', ({ reason }) => {
        if (app.screen === 'game') this.stopMatch();
        this.teardownSession();
        app.errorMessage = `Connection lost: ${reason}`;
        app.screen = 'menu';
      }),

      session.events.on('phase', ({ phase }) => {
        this.audio.play('phase');
        if (phase === GamePhase.Preparation && app.screen === 'lobby') {
          app.killFeed = [];
          app.lastResult = null;
          app.screen = 'game';
        }
        if (phase === GamePhase.Waiting && app.screen === 'game') {
          app.screen = 'lobby';
        }
      }),

      session.events.on('sim', (event) => this.onSimEvent(session, event)),
    );
  }

  private onSimEvent(session: GameSession, event: SimEvent): void {
    const name = (netId: number) => app.roster.find((r) => r.netId === netId)?.name ?? `P${netId}`;
    const me = session.localNetId;
    const listener = () => {
      const local = session.localState();
      return local
        ? { x: local.record.x, z: local.record.z, yaw: local.record.yaw }
        : { x: 0, z: 0, yaw: 0 };
    };

    switch (event.type) {
      case 'roleAssigned':
        app.hunterName = name(event.hunterNetId);
        break;
      case 'attack':
        if (event.attackerNetId === me) {
          this.renderer?.flashAttack();
          this.audio.play('attack');
          if (event.hitPropId !== undefined) this.audio.play('hit');
        } else {
          this.audio.play('attack', { ...listener(), listener: listener() });
        }
        break;
      case 'eliminated':
        this.audio.play('eliminated');
        app.pushKill(`${name(event.byNetId)} found ${name(event.netId)}!`);
        break;
      case 'possessed':
        if (event.netId === me) this.audio.play('possess');
        break;
      case 'lockChanged':
        if (event.netId === me) this.audio.play('lock');
        break;
      case 'taunt':
        this.audio.play('taunt', { x: event.x, z: event.z, listener: listener() });
        break;
      case 'roundEnd': {
        const local = session.localState();
        const won =
          event.winner === 'hunter'
            ? local?.record.role === 'hunter'
            : local?.record.role === 'hider' && (local?.record.alive ?? false);
        app.lastResult = {
          winner: event.winner,
          survivorNames: event.survivors.map(name),
          localWon: won ?? false,
        };
        this.audio.play(won ? 'win' : 'lose');
        break;
      }
      default:
        break;
    }
  }

  private unwire(): void {
    for (const unsub of this.unsubs) unsub();
    this.unsubs = [];
  }

  private teardownSession(): void {
    this.unwire();
    this.stopIdleTicking();
    this.session?.leave();
    this.session = null;
    this.seq = 0;
    app.roster = [];
    app.killFeed = [];
    app.lastResult = null;
    app.phase = GamePhase.Waiting;
    app.isHost = false;
  }
}

/** App-wide singleton (composition root). */
export const facade = new GameFacade();
