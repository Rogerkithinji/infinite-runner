/**
 * Every tunable number lives here. Gameplay feel is mostly a tuning problem,
 * so keeping the knobs in one file makes the rest of the code boring on purpose.
 */

export const LANES = [-2.4, 0, 2.4] as const;
export const LANE_COUNT = LANES.length;

/** Simulation runs on a fixed timestep; rendering runs as fast as the display. */
export const FIXED_DT = 1 / 120;
/** Never simulate more than this many steps per frame (tab-switch protection). */
export const MAX_STEPS_PER_FRAME = 6;

export const PLAYER = {
  size: 0.9,
  /** How fast the cube slides between lanes (units of "approach per second"). */
  laneSpeed: 14,
  jumpVelocity: 9.2,
  gravity: -26,
  /** Extra gravity while falling — makes jumps feel snappy rather than floaty. */
  fallMultiplier: 1.7,
  /** Holding jump for longer gives a slightly higher hop. */
  lowJumpMultiplier: 2.6,
  /** Grace window (seconds) where a jump pressed just before landing still fires. */
  jumpBuffer: 0.12,
  maxRoll: 0.42,
} as const;

export const WORLD = {
  startSpeed: 13,
  maxSpeed: 34,
  /** Units/second added to the run speed, per second survived. */
  acceleration: 0.55,
  /** How far ahead of the camera obstacles are spawned. */
  spawnZ: -110,
  /** Everything past this Z is behind the player and gets recycled. */
  despawnZ: 12,
  groundWidth: 22,
  fogNear: 18,
  fogFar: 105,
} as const;

export const SPAWN = {
  /** Distance between obstacle rows at the start of a run. */
  startGap: 15,
  /** Gaps tighten as the run goes on, but never below this. */
  minGap: 7.5,
  gapTightenPerSecond: 0.09,
  /** Seconds of calm before the first obstacle shows up. */
  gracePeriod: 1.6,
} as const;

export const SCORE = {
  /** Points per metre travelled. */
  perMetre: 1,
  nearMiss: 25,
  /** Lateral+vertical distance that counts as a near miss. */
  nearMissRadius: 1.35,
} as const;

export const POOL_SIZE = 28;

/** The whole palette, shared by the 3D scene and the CSS layer. */
export const PALETTE = {
  void: 0x08090b,
  ground: 0x101216,
  grid: 0x2b3038,
  bone: 0xe8e3d9,
  signal: 0xff5a1f,
  coolant: 0x35d6d0,
  danger: 0xff2d55,
} as const;
