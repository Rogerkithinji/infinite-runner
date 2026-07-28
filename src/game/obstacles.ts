import * as THREE from "three";
import { LANES, PALETTE, POOL_SIZE, SPAWN, WORLD } from "./config";
import { makeAABB, type AABB } from "./collision";
import { Pool } from "./pool";

export type ObstacleKind = "slab" | "pylon";

/** Low and wide — clear it with a jump. */
const SLAB = { w: 2.1, h: 0.72, d: 0.9 };
/** Tall — you are not getting over this one, change lanes. */
const PYLON = { w: 1.7, h: 2.8, d: 0.9 };

export type Obstacle = {
  kind: ObstacleKind;
  mesh: THREE.Mesh;
  box: AABB;
  /** Scored once, when it slips behind the player. */
  counted: boolean;
};

/**
 * Row patterns, expressed as which lanes hold what. Every pattern leaves at
 * least one survivable answer: a lane that is empty, or a slab you can jump.
 */
type Row = (ObstacleKind | null)[];

const EASY: Row[] = [
  ["pylon", null, null],
  [null, null, "pylon"],
  [null, "pylon", null],
  ["slab", null, null],
  [null, null, "slab"],
];

const MEDIUM: Row[] = [
  ["pylon", null, "pylon"],
  ["pylon", "pylon", null],
  [null, "pylon", "pylon"],
  ["slab", "slab", "slab"],
  ["slab", null, "pylon"],
  ["pylon", null, "slab"],
];

const HARD: Row[] = [
  ["slab", "pylon", "slab"],
  ["pylon", "slab", "pylon"],
  ["slab", "slab", "pylon"],
  ["pylon", "slab", "slab"],
];

export class ObstacleField {
  readonly group = new THREE.Group();

  private readonly pool: Pool<Obstacle>;
  private readonly disposables: { dispose(): void }[] = [];

  /** World distance still to cover before the next row is placed. */
  private distanceToNextRow = SPAWN.gracePeriod * WORLD.startSpeed;
  private gap: number = SPAWN.startGap;
  private lastRow: Row | null = null;

  constructor() {
    const slabGeo = new THREE.BoxGeometry(SLAB.w, SLAB.h, SLAB.d);
    const pylonGeo = new THREE.BoxGeometry(PYLON.w, PYLON.h, PYLON.d);

    const slabMat = new THREE.MeshStandardMaterial({
      color: 0x1b1f26,
      roughness: 0.5,
      metalness: 0.2,
      emissive: PALETTE.coolant,
      emissiveIntensity: 0.35,
    });
    const pylonMat = new THREE.MeshStandardMaterial({
      color: 0x1b1f26,
      roughness: 0.5,
      metalness: 0.2,
      emissive: PALETTE.danger,
      emissiveIntensity: 0.32,
    });
    const slabEdgeMat = new THREE.LineBasicMaterial({ color: PALETTE.coolant });
    const pylonEdgeMat = new THREE.LineBasicMaterial({ color: PALETTE.danger });
    const slabEdgeGeo = new THREE.EdgesGeometry(slabGeo);
    const pylonEdgeGeo = new THREE.EdgesGeometry(pylonGeo);

    this.disposables.push(
      slabGeo,
      pylonGeo,
      slabMat,
      pylonMat,
      slabEdgeMat,
      pylonEdgeMat,
      slabEdgeGeo,
      pylonEdgeGeo,
    );

    // Build the entire pool now. Nothing is constructed again after this point.
    this.pool = new Pool<Obstacle>(POOL_SIZE, (index) => {
      const kind: ObstacleKind = index % 2 === 0 ? "slab" : "pylon";
      const dims = kind === "slab" ? SLAB : PYLON;
      const mesh = new THREE.Mesh(
        kind === "slab" ? slabGeo : pylonGeo,
        kind === "slab" ? slabMat : pylonMat,
      );
      mesh.add(
        new THREE.LineSegments(
          kind === "slab" ? slabEdgeGeo : pylonEdgeGeo,
          kind === "slab" ? slabEdgeMat : pylonEdgeMat,
        ),
      );
      mesh.visible = false;
      mesh.castShadow = true;
      this.group.add(mesh);
      return {
        kind,
        mesh,
        box: makeAABB(dims.w / 2, dims.h / 2, dims.d / 2),
        counted: false,
      };
    });
  }

  /** Only obstacles that are actually on the track. */
  active(): Iterable<Obstacle> {
    return this.pool.active();
  }

  reset(): void {
    for (const obstacle of this.pool.active()) obstacle.mesh.visible = false;
    this.pool.releaseAll();
    this.distanceToNextRow = SPAWN.gracePeriod * WORLD.startSpeed;
    this.gap = SPAWN.startGap;
    this.lastRow = null;
  }

  update(dt: number, speed: number, elapsed: number): void {
    const distance = speed * dt;

    for (const obstacle of this.pool.active()) {
      obstacle.mesh.position.z += distance;
      obstacle.box.cz = obstacle.mesh.position.z;
      if (obstacle.mesh.position.z > WORLD.despawnZ) {
        obstacle.mesh.visible = false;
        this.pool.release(obstacle);
      }
    }

    // Rows are spawned by distance travelled, not by wall-clock time — so the
    // track layout is identical whether you run at 60fps or 144fps.
    this.distanceToNextRow -= distance;
    if (this.distanceToNextRow <= 0) {
      this.spawnRow(elapsed);
      this.gap = Math.max(SPAWN.minGap, this.gap - SPAWN.gapTightenPerSecond * this.gap * dt * 60);
      this.distanceToNextRow += this.gap;
    }
  }

  private pickRow(elapsed: number): Row {
    const table =
      elapsed < 12
        ? EASY
        : elapsed < 30
          ? [...EASY, ...MEDIUM]
          : elapsed < 55
            ? [...MEDIUM, ...HARD]
            : [...MEDIUM, ...HARD, ...HARD];

    for (let attempt = 0; attempt < 6; attempt++) {
      const row = table[(Math.random() * table.length) | 0];
      // Two identical rows back to back feel like a rendering glitch.
      if (!this.lastRow || row.some((cell, i) => cell !== this.lastRow![i])) return row;
    }
    return table[0];
  }

  private spawnRow(elapsed: number): void {
    const row = this.pickRow(elapsed);
    this.lastRow = row;

    for (let lane = 0; lane < row.length; lane++) {
      const kind = row[lane];
      if (!kind) continue;

      // Ask the pool for a body of the right shape. If none is free we simply
      // skip this cell — a dropped obstacle is invisible to the player, whereas
      // growing the pool mid-run is a frame hitch they would feel.
      const obstacle = this.take(kind);
      if (!obstacle) continue;

      const dims = kind === "slab" ? SLAB : PYLON;
      obstacle.counted = false;
      obstacle.mesh.visible = true;
      obstacle.mesh.position.set(LANES[lane], dims.h / 2, WORLD.spawnZ);
      obstacle.box.cx = LANES[lane];
      obstacle.box.cy = dims.h / 2;
      obstacle.box.cz = WORLD.spawnZ;
    }
  }

  /** Pull from the pool until we get the requested kind, returning rejects. */
  private take(kind: ObstacleKind): Obstacle | null {
    const rejected: Obstacle[] = [];
    let found: Obstacle | null = null;

    for (let i = 0; i < POOL_SIZE; i++) {
      const candidate = this.pool.acquire();
      if (!candidate) break;
      if (candidate.kind === kind) {
        found = candidate;
        break;
      }
      rejected.push(candidate);
    }

    for (const item of rejected) this.pool.release(item);
    return found;
  }

  dispose(): void {
    for (const item of this.disposables) item.dispose();
  }
}
