/**
 * Unified input: touch (virtual joystick + drag-look), keyboard/mouse
 * (WASD + pointer-lock), and HUD action buttons.
 *
 * The manager accumulates intent between fixed ticks; `sample(seq)` snapshots
 * it into an InputCommand. Action buttons are one-shot: a press is included in
 * exactly one command (the host edge-detects, so this yields one action per
 * press regardless of frame/tick alignment).
 *
 * Touch layout: left 45% of the screen = dynamic joystick; the rest = look
 * drag. HUD buttons overlay via `pressButton`.
 */
import { clamp } from '../core/math/scalar';
import { Buttons, type InputCommand } from '../game/types';

const JOYSTICK_RADIUS_PX = 60;
const TOUCH_LOOK_SPEED = 0.008;
const MOUSE_LOOK_SPEED = 0.0022;
const PITCH_LIMIT = Math.PI / 2 - 0.05;

interface JoystickState {
  pointerId: number;
  baseX: number;
  baseY: number;
  dx: number;
  dy: number;
}

interface LookState {
  pointerId: number;
  lastX: number;
  lastY: number;
}

export class InputManager {
  yaw = 0;
  pitch = 0;
  sensitivity = 1;

  /** Local, NON-networked view toggle (first/third person). Kept off the
   * Buttons/InputCommand path because it changes only local rendering. */
  onViewToggle: (() => void) | null = null;

  private keys = new Set<string>();
  private pendingButtons = 0;
  private joystick: JoystickState | null = null;
  private look: LookState | null = null;
  private element: HTMLElement | null = null;
  private detachFns: (() => void)[] = [];

  /** Joystick visual state for the HUD overlay (null when inactive). */
  joystickVisual(): { baseX: number; baseY: number; dx: number; dy: number } | null {
    return this.joystick
      ? {
          baseX: this.joystick.baseX,
          baseY: this.joystick.baseY,
          dx: this.joystick.dx,
          dy: this.joystick.dy,
        }
      : null;
  }

  attach(element: HTMLElement): void {
    this.detach();
    this.element = element;

    const on = <K extends keyof HTMLElementEventMap>(
      target: HTMLElement | Window,
      type: K | string,
      fn: (ev: never) => void,
      opts?: AddEventListenerOptions,
    ) => {
      target.addEventListener(type as string, fn as EventListener, opts);
      this.detachFns.push(() =>
        target.removeEventListener(type as string, fn as EventListener, opts),
      );
    };

    // ── Touch / pointer ──
    on(element, 'pointerdown', (ev: PointerEvent) => {
      if (ev.pointerType === 'mouse') {
        // Desktop: click requests pointer lock; primary button attacks when locked.
        if (document.pointerLockElement === element) {
          this.pendingButtons |= Buttons.Attack;
        } else {
          // requestPointerLock returns a Promise in newer Chrome and can reject
          // (or throw synchronously) in some contexts — iframes, headless, no user
          // activation. Swallow it; look still works fine without a lock.
          try {
            const req = element.requestPointerLock?.() as unknown as Promise<void> | undefined;
            req?.catch?.(() => {});
          } catch {
            /* pointer lock unavailable */
          }
        }
        return;
      }
      const rect = element.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      if (x < rect.width * 0.45 && !this.joystick) {
        this.joystick = {
          pointerId: ev.pointerId,
          baseX: ev.clientX,
          baseY: ev.clientY,
          dx: 0,
          dy: 0,
        };
      } else if (!this.look) {
        this.look = { pointerId: ev.pointerId, lastX: ev.clientX, lastY: ev.clientY };
      }
      element.setPointerCapture(ev.pointerId);
    });

    on(element, 'pointermove', (ev: PointerEvent) => {
      if (ev.pointerType === 'mouse') {
        if (document.pointerLockElement === element) {
          this.applyLook(ev.movementX * MOUSE_LOOK_SPEED, ev.movementY * MOUSE_LOOK_SPEED);
        }
        return;
      }
      if (this.joystick?.pointerId === ev.pointerId) {
        this.joystick.dx = ev.clientX - this.joystick.baseX;
        this.joystick.dy = ev.clientY - this.joystick.baseY;
      } else if (this.look?.pointerId === ev.pointerId) {
        const dx = ev.clientX - this.look.lastX;
        const dy = ev.clientY - this.look.lastY;
        this.look.lastX = ev.clientX;
        this.look.lastY = ev.clientY;
        this.applyLook(dx * TOUCH_LOOK_SPEED, dy * TOUCH_LOOK_SPEED);
      }
    });

    const endPointer = (ev: PointerEvent) => {
      if (this.joystick?.pointerId === ev.pointerId) this.joystick = null;
      if (this.look?.pointerId === ev.pointerId) this.look = null;
    };
    on(element, 'pointerup', endPointer);
    on(element, 'pointercancel', endPointer);

    // ── Keyboard ──
    on(window, 'keydown', (ev: KeyboardEvent) => {
      if (ev.repeat) return;
      this.keys.add(ev.code);
      switch (ev.code) {
        case 'Space':
          this.pendingButtons |= Buttons.Attack;
          break;
        case 'KeyE':
          this.pendingButtons |= Buttons.Possess;
          break;
        case 'KeyF':
          this.pendingButtons |= Buttons.Lock;
          break;
        case 'KeyT':
          this.pendingButtons |= Buttons.Taunt;
          break;
        case 'KeyV':
          this.onViewToggle?.();
          break;
      }
    });
    on(window, 'keyup', (ev: KeyboardEvent) => this.keys.delete(ev.code));
  }

  detach(): void {
    for (const fn of this.detachFns) fn();
    this.detachFns = [];
    this.keys.clear();
    this.joystick = null;
    this.look = null;
    if (this.element && document.pointerLockElement === this.element) {
      document.exitPointerLock?.();
    }
    this.element = null;
  }

  /** HUD action buttons (touch UI). */
  pressButton(button: Buttons): void {
    this.pendingButtons |= button;
  }

  /** Snapshot intent into an InputCommand; one-shot buttons are consumed. */
  sample(seq: number): InputCommand {
    let moveX = 0;
    let moveZ = 0;

    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) moveZ += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) moveZ -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) moveX += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) moveX -= 1;

    if (this.joystick) {
      moveX = clamp(this.joystick.dx / JOYSTICK_RADIUS_PX, -1, 1);
      moveZ = clamp(-this.joystick.dy / JOYSTICK_RADIUS_PX, -1, 1);
    }

    const buttons = this.pendingButtons;
    this.pendingButtons = 0;

    return { seq, moveX, moveZ, yaw: this.yaw, pitch: this.pitch, buttons };
  }

  private applyLook(dyaw: number, dpitch: number): void {
    this.yaw += dyaw * this.sensitivity;
    // Keep yaw in [-PI, PI] to match the wire encoding.
    if (this.yaw > Math.PI) this.yaw -= Math.PI * 2;
    else if (this.yaw < -Math.PI) this.yaw += Math.PI * 2;
    this.pitch = clamp(this.pitch + dpitch * this.sensitivity, -PITCH_LIMIT, PITCH_LIMIT);
  }
}
