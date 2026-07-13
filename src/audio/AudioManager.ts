/**
 * Web Audio SFX, fully synthesized — no audio assets to download or cache,
 * which keeps the PWA payload tiny and guarantees offline availability.
 *
 * Buses: master → sfx. Positional one-shots use a StereoPanner + distance gain
 * relative to the listener pose (cheap approximation; full HRTF PannerNode is
 * a Beta upgrade). The context unlocks on the first user gesture (`unlock`).
 */

export type SfxName =
  | 'click'
  | 'possess'
  | 'lock'
  | 'attack'
  | 'hit'
  | 'eliminated'
  | 'taunt'
  | 'phase'
  | 'win'
  | 'lose';

export interface ListenerPose {
  x: number;
  z: number;
  yaw: number;
}

interface PlayOptions {
  /** World position for positional audio (omit for UI sounds). */
  x?: number;
  z?: number;
  listener?: ListenerPose;
}

const MAX_HEAR_DISTANCE = 24;

export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private _volume = 0.8;

  /** Call from a user gesture (button tap) — required by autoplay policies. */
  unlock(): void {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this._volume;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setVolume(volume: number): void {
    this._volume = Math.max(0, Math.min(1, volume));
    if (this.master) this.master.gain.value = this._volume;
  }

  get volume(): number {
    return this._volume;
  }

  play(name: SfxName, opts: PlayOptions = {}): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;

    // Spatialize: pan by bearing, attenuate by distance.
    let out: AudioNode = this.master;
    if (opts.x !== undefined && opts.z !== undefined && opts.listener) {
      const dx = opts.x - opts.listener.x;
      const dz = opts.z - opts.listener.z;
      const dist = Math.hypot(dx, dz);
      if (dist > MAX_HEAR_DISTANCE) return;
      const bearing = Math.atan2(dx, dz) - opts.listener.yaw;
      const panner = this.ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, Math.sin(bearing)));
      const gain = this.ctx.createGain();
      gain.gain.value = 1 - dist / MAX_HEAR_DISTANCE;
      gain.connect(panner);
      panner.connect(this.master);
      out = gain;
    }

    switch (name) {
      case 'click':
        this.tone(out, t, 'square', 700, 700, 0.05, 0.15);
        break;
      case 'possess':
        this.tone(out, t, 'sine', 300, 900, 0.18, 0.3);
        break;
      case 'lock':
        this.tone(out, t, 'square', 500, 380, 0.08, 0.25);
        break;
      case 'attack':
        this.noise(out, t, 0.12, 0.35);
        this.tone(out, t, 'sine', 160, 60, 0.15, 0.4);
        break;
      case 'hit':
        this.tone(out, t, 'sawtooth', 420, 140, 0.2, 0.4);
        break;
      case 'eliminated':
        this.tone(out, t, 'sawtooth', 330, 110, 0.35, 0.35);
        this.tone(out, t + 0.12, 'sawtooth', 262, 87, 0.4, 0.3);
        break;
      case 'taunt':
        this.tone(out, t, 'square', 220, 260, 0.1, 0.3);
        this.tone(out, t + 0.12, 'square', 260, 220, 0.12, 0.3);
        break;
      case 'phase':
        this.tone(out, t, 'sine', 523, 523, 0.1, 0.25);
        this.tone(out, t + 0.11, 'sine', 784, 784, 0.16, 0.25);
        break;
      case 'win':
        [523, 659, 784, 1046].forEach((f, i) =>
          this.tone(out, t + i * 0.12, 'triangle', f, f, 0.14, 0.3),
        );
        break;
      case 'lose':
        [392, 330, 262, 196].forEach((f, i) =>
          this.tone(out, t + i * 0.14, 'sawtooth', f, f, 0.16, 0.25),
        );
        break;
    }
  }

  private tone(
    out: AudioNode,
    at: number,
    type: OscillatorType,
    freqFrom: number,
    freqTo: number,
    duration: number,
    gain: number,
  ): void {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freqFrom, at);
    if (freqTo !== freqFrom)
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqTo), at + duration);
    env.gain.setValueAtTime(gain, at);
    env.gain.exponentialRampToValueAtTime(0.001, at + duration);
    osc.connect(env);
    env.connect(out);
    osc.start(at);
    osc.stop(at + duration + 0.02);
  }

  private noise(out: AudioNode, at: number, duration: number, gain: number): void {
    if (!this.ctx) return;
    const length = Math.ceil(this.ctx.sampleRate * duration);
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const env = this.ctx.createGain();
    env.gain.value = gain;
    src.connect(env);
    env.connect(out);
    src.start(at);
  }
}
