# RUNNER // infinite

A three.js endless runner built on Next.js. Vault the orange slabs, evade the red
pylons, and the corridor keeps getting faster.

**Controls** — `A`/`D` or `←`/`→` to change lane, `Space` to jump, `R` to restart.
Touch: swipe left/right, swipe up or tap to jump.

## Running it

```bash
pnpm install
pnpm dev
```

## What this is a study in

**Fixed-timestep game loop** — `src/game/game.ts`
The wall-clock delta is clamped and then spent in fixed `1/120s` chunks, so the
simulation behaves identically on a 60Hz laptop and a 240Hz monitor, and one long
frame can never teleport the cube through an obstacle. Rendering still happens
once per `requestAnimationFrame`, at whatever rate the display runs.

**Delta timing everywhere else** — `src/game/player.ts`, `src/game/track.ts`
Nothing moves per-frame; everything moves per-second. Smoothing uses
`1 - Math.exp(-k * dt)` rather than a fixed lerp factor, which is the same easing
curve at any framerate.

**Input as intents** — `src/game/input.ts`
Keyboard, swipe, and tap all collapse into `left | right | jump | start`, queued
rather than polled so a press between two simulation steps is never dropped. Held
state is tracked separately, which is what makes variable jump height work.

**Object pooling** — `src/game/pool.ts`, `src/game/obstacles.ts`
Every obstacle mesh is built once at startup and recycled forever. Allocating
meshes mid-run means garbage every few seconds, and that GC pause always seems to
land mid-jump.

**Hand-rolled AABB collision** — `src/game/collision.ts`
`Box3` would do, but the point is that an axis-aligned overlap test is three
comparisons: two boxes intersect when they intersect on every axis independently.
Nothing rotates here, so it is exact.

## Layout

```
src/game/       simulation — no React, no DOM beyond the canvas
  config.ts       every tunable number
  game.ts         loop, state machine, camera
  player.ts       the cube: lanes, jump arc, squash
  obstacles.ts    pooled spawner + row patterns
  track.ts        UV-scrolled ground, recycled posts, dust
  collision.ts    AABB
  pool.ts         fixed-size object pool
  input.ts        keyboard / touch → intents
  audio.ts        procedural WebAudio blips, no asset files
src/components/ React owns the HUD overlay and nothing else
src/app/        route + the design system in globals.css
```

The game pushes a throttled snapshot out to React (~16/s) so a 120Hz simulation
never turns into 120 re-renders a second.

## Notes

The ground never actually moves. Scrolling a real plane forever hits float
precision within minutes, so the geometry is static and the *texture coordinates*
scroll instead — they wrap cleanly at 1.0 and can run for days.
