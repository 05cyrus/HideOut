/**
 * Shared domain types for the game simulation.
 *
 * Pure data — no DOM, Babylon, or network imports. These types cross the
 * game/net boundary (the codec serializes them) and the game/render boundary
 * (views are derived from them), so they live at the root of the domain.
 */

export type Role = 'hider' | 'hunter';

export enum GamePhase {
  /** Lobby / free-roam warmup. Players can move, no roles active. */
  Waiting = 0,
  /** Round starting: roles shown, everyone frozen briefly. */
  Preparation = 1,
  /** Hiders hide & possess props; hunter is frozen and blindfolded. */
  Hiding = 2,
  /** Hunter released. The round proper. */
  Hunting = 3,
  /** Winner determined; results shown, then back to Waiting. */
  RoundEnd = 4,
}

export enum PropType {
  None = 0,
  Crate = 1,
  Barrel = 2,
  Plant = 3,
  Chair = 4,
  Table = 5,
  Lamp = 6,
  Shelf = 7,
  TrashCan = 8,
  CardboardBox = 9,
  Pallet = 10,
  Cone = 11,
  Spool = 12,
}

/** Input button bitfield. Actions ride the input stream so the host can
 * validate them tick-aligned (cooldowns, phase rules) — no separate RPCs. */
export enum Buttons {
  Attack = 1 << 0,
  Possess = 1 << 1,
  Lock = 1 << 2,
  Taunt = 1 << 3,
}

/**
 * One tick of player intent, produced by the local input layer, sent
 * client→host (unreliable, redundantly), and replayed for prediction.
 */
export interface InputCommand {
  /** Monotonic per-player sequence number (u16 wraps are tolerated on LAN sessions). */
  seq: number;
  /** Strafe axis, normalized [-1, 1]. */
  moveX: number;
  /** Forward axis, normalized [-1, 1]. */
  moveZ: number;
  /** Absolute look yaw in radians [-PI, PI]. */
  yaw: number;
  /** Absolute look pitch in radians, clamped to ±PI/2. */
  pitch: number;
  /** Bitfield of `Buttons`. */
  buttons: number;
}

/** Wire-level per-entity state; also the host's authoritative export. */
export interface EntityRecord {
  netId: number;
  x: number;
  z: number;
  yaw: number;
  alive: boolean;
  role: Role;
  /** PropType.None when not disguised. */
  propType: PropType;
  locked: boolean;
  /** Hunter HP 0-100; 255 for non-hunters. */
  health: number;
}

/** Events the simulation emits each tick; the host session broadcasts them. */
export type SimEvent =
  | { type: 'phase'; phase: GamePhase; durationTicks: number }
  | { type: 'roleAssigned'; hunterNetId: number }
  | {
      type: 'attack';
      attackerNetId: number;
      /** Set when an innocent map prop was hit. */
      hitPropId?: number;
      /** Set when a player was hit (they are eliminated). */
      victimNetId?: number;
      hunterHp: number;
    }
  | { type: 'eliminated'; netId: number; byNetId: number }
  | { type: 'possessed'; netId: number; propType: PropType; propId: number; swapsLeft: number }
  | { type: 'lockChanged'; netId: number; locked: boolean }
  | { type: 'taunt'; netId: number; x: number; z: number }
  | { type: 'roundEnd'; winner: 'hunter' | 'hiders'; survivors: number[] };
