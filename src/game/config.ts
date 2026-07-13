/**
 * Gameplay tunables. Everything that shapes balance lives here so design
 * iteration (and per-round host settings later) never touches system code.
 * Tests inject shortened timers via `withConfig`.
 */
export interface GameConfig {
  /** Fixed simulation rate (Hz). Both host and prediction step at this rate. */
  tickRate: number;
  player: {
    /** Collision circle radius on the XZ plane (m). */
    radius: number;
    /** Eye height for the first-person camera and attack rays (m). */
    eyeHeight: number;
    walkSpeed: number;
    /** Movement speed while disguised as a prop (m/s). */
    disguisedSpeed: number;
  };
  hunter: {
    hp: number;
    /** HP lost for attacking an innocent prop. */
    wrongPropDamage: number;
    attackRange: number;
    attackCooldownSeconds: number;
  };
  props: {
    /** Max distance to a prop to possess it (m). */
    possessRange: number;
    /** Disguise changes allowed per round. */
    maxSwaps: number;
    /** Cooldown for a MANUAL "bait" taunt (button press). */
    tauntCooldownSeconds: number;
    /** Forced auto-taunt interval at the START of the hunt (s). */
    tauntIntervalSeconds: number;
    /** Forced auto-taunt interval near the END of the hunt (s) — the escalation floor. */
    tauntMinIntervalSeconds: number;
  };
  round: {
    preparationSeconds: number;
    hidingSeconds: number;
    huntingSeconds: number;
    roundEndSeconds: number;
    /** Minimum players to start a round. */
    minPlayers: number;
  };
  net: {
    /** Recent input commands re-sent per packet to mask packet loss. */
    inputRedundancy: number;
    /** Remote-entity interpolation delay, in ticks. */
    interpDelayTicks: number;
    /** Max queued inputs applied per player per tick (catch-up bound). */
    maxInputsPerTick: number;
  };
}

export const defaultConfig: GameConfig = {
  tickRate: 30,
  player: {
    radius: 0.4,
    eyeHeight: 1.6,
    walkSpeed: 4.5,
    disguisedSpeed: 2.2,
  },
  hunter: {
    hp: 100,
    wrongPropDamage: 12,
    attackRange: 6,
    attackCooldownSeconds: 0.8,
  },
  props: {
    possessRange: 2.5,
    maxSwaps: 3,
    tauntCooldownSeconds: 8,
    tauntIntervalSeconds: 30,
    tauntMinIntervalSeconds: 12,
  },
  round: {
    preparationSeconds: 4,
    hidingSeconds: 25,
    huntingSeconds: 180,
    roundEndSeconds: 8,
    minPlayers: 2,
  },
  net: {
    inputRedundancy: 3,
    interpDelayTicks: 3,
    maxInputsPerTick: 4,
  },
};

/** Shallow-merge overrides onto the default config (per-section). */
export function withConfig(overrides: {
  [K in keyof GameConfig]?: Partial<GameConfig[K]>;
}): GameConfig {
  return {
    tickRate: (overrides.tickRate as number | undefined) ?? defaultConfig.tickRate,
    player: { ...defaultConfig.player, ...overrides.player },
    hunter: { ...defaultConfig.hunter, ...overrides.hunter },
    props: { ...defaultConfig.props, ...overrides.props },
    round: { ...defaultConfig.round, ...overrides.round },
    net: { ...defaultConfig.net, ...overrides.net },
  };
}
