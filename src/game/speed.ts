/**
 * Movement speed rules, shared VERBATIM by the host simulation and client-side
 * prediction. If these ever diverge, prediction rubber-bands — change with care.
 */
import { GamePhase, PropType, type Role } from './types';
import type { GameConfig } from './config';

export function resolveSpeed(
  config: GameConfig,
  phase: GamePhase,
  role: Role,
  alive: boolean,
  propType: PropType,
  locked: boolean,
): number {
  if (!alive) return 0;

  switch (phase) {
    case GamePhase.Waiting:
    case GamePhase.RoundEnd:
      return config.player.walkSpeed;
    case GamePhase.Preparation:
      return 0;
    case GamePhase.Hiding:
      if (role === 'hunter') return 0; // hunter frozen while hiders hide
      return disguisedSpeed(config, propType, locked);
    case GamePhase.Hunting:
      if (role === 'hunter') return config.player.walkSpeed;
      return disguisedSpeed(config, propType, locked);
  }
}

function disguisedSpeed(config: GameConfig, propType: PropType, locked: boolean): number {
  if (propType === PropType.None) return config.player.walkSpeed;
  if (locked) return 0;
  return config.player.disguisedSpeed;
}
