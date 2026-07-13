/**
 * ECS component definitions for the game domain. Data only — behavior lives in
 * the simulation systems.
 */
import { defineComponent } from '../core/ecs';
import { create as vec3Create, type Vec3 } from '../core/math/vec3';
import { PropType, type InputCommand, type Role } from './types';

export interface TransformData {
  pos: Vec3;
  yaw: number;
  pitch: number;
}
export const Transform = defineComponent<TransformData>('Transform', () => ({
  pos: vec3Create(),
  yaw: 0,
  pitch: 0,
}));

export interface PlayerData {
  netId: number;
  name: string;
  role: Role;
  alive: boolean;
  ready: boolean;
}
export const Player = defineComponent<PlayerData>('Player', () => ({
  netId: -1,
  name: '',
  role: 'hider',
  alive: true,
  ready: false,
}));

export interface DisguiseData {
  propType: PropType;
  /** Map prop id the disguise was copied from (-1 when none). */
  propId: number;
  swapsLeft: number;
  locked: boolean;
}
export const Disguise = defineComponent<DisguiseData>('Disguise', () => ({
  propType: PropType.None,
  propId: -1,
  swapsLeft: 0,
  locked: false,
}));

export interface HunterData {
  hp: number;
  cooldownTicks: number;
}
export const Hunter = defineComponent<HunterData>('Hunter', () => ({
  hp: 100,
  cooldownTicks: 0,
}));

export interface InputQueueData {
  queue: InputCommand[];
  /** Highest seq accepted into the queue (dedupes redundant sends). */
  lastQueuedSeq: number;
  /** Highest seq actually simulated (echoed in snapshots for reconciliation). */
  lastProcessedSeq: number;
  /** Previous tick's button bits, for edge detection. */
  lastButtons: number;
  /** Cooldown for a manual "bait" taunt. */
  tauntCooldownTicks: number;
  /** Countdown to the next FORCED auto-taunt during the hunt (ticks). */
  autoTauntTicks: number;
}
export const InputQueue = defineComponent<InputQueueData>('InputQueue', () => ({
  queue: [],
  lastQueuedSeq: -1,
  lastProcessedSeq: -1,
  lastButtons: 0,
  tauntCooldownTicks: 0,
  autoTauntTicks: 0,
}));
