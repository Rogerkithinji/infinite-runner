import * as THREE from "three";
import { LANES, LANE_COUNT, PALETTE, PLAYER } from "./config";
import { makeAABB, type AABB } from "./collision";

/**
 * The runner. A cube with opinions.
 *
 * Two details do most of the work for feel:
 *  - variable jump height (release early, hop lower) via a gravity multiplier,
 *  - a jump buffer, so a press landing a few frames before touchdown still fires
 *    instead of being silently eaten.
 */
export class Player {
  readonly group = new THREE.Group();
  readonly box: AABB;

  private readonly mesh: THREE.Mesh;
  private readonly shadow: THREE.Mesh;
  private readonly disposables: { dispose(): void }[] = [];

  lane = 1;
  private y = PLAYER.size / 2;
  private vy = 0;
  private grounded = true;
  private bufferedJump = 0;
  private squash = 1;
  private roll = 0;
  private spin = 0;

  constructor() {
    const half = PLAYER.size / 2;
    this.box = makeAABB(half * 0.86, half * 0.86, half * 0.86);

    const geo = new THREE.BoxGeometry(PLAYER.size, PLAYER.size, PLAYER.size);
    const mat = new THREE.MeshStandardMaterial({
      color: PALETTE.bone,
      roughness: 0.35,
      metalness: 0.1,
      emissive: PALETTE.signal,
      emissiveIntensity: 0.12,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.castShadow = true;

    // Wireframe overcoat — reads as "instrumented object" rather than "cube".
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: PALETTE.signal }),
    );
    edges.scale.setScalar(1.03);
    this.mesh.add(edges);
    this.disposables.push(edges.geometry, edges.material);

    // Fake contact shadow: a disc that shrinks and fades with altitude. Cheaper
    // and more legible than a real shadow map at this camera angle.
    const shadowGeo = new THREE.CircleGeometry(half * 1.25, 24);
    const shadowMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    this.shadow = new THREE.Mesh(shadowGeo, shadowMat);
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.03;

    this.group.add(this.mesh, this.shadow);
    this.disposables.push(geo, mat, shadowGeo, shadowMat);

    this.reset();
  }

  get airborne(): boolean {
    return !this.grounded;
  }

  reset(): void {
    this.lane = 1;
    this.y = PLAYER.size / 2;
    this.vy = 0;
    this.grounded = true;
    this.bufferedJump = 0;
    this.squash = 1;
    this.roll = 0;
    this.spin = 0;
    this.mesh.position.set(0, this.y, 0);
    this.group.position.x = LANES[1];
  }

  move(direction: -1 | 1): void {
    this.lane = THREE.MathUtils.clamp(this.lane + direction, 0, LANE_COUNT - 1);
  }

  requestJump(): void {
    this.bufferedJump = PLAYER.jumpBuffer;
  }

  /** Returns true on the frame the cube touches down, so callers can react. */
  update(dt: number, jumpHeld: boolean): { justLanded: boolean; jumped: boolean } {
    let jumped = false;

    if (this.bufferedJump > 0) {
      this.bufferedJump -= dt;
      if (this.grounded) {
        this.vy = PLAYER.jumpVelocity;
        this.grounded = false;
        this.bufferedJump = 0;
        this.squash = 0.72;
        jumped = true;
      }
    }

    // Asymmetric gravity: heavier on the way down, heavier still if the jump
    // button was released early.
    let gravity = PLAYER.gravity;
    if (this.vy < 0) gravity *= PLAYER.fallMultiplier;
    else if (this.vy > 0 && !jumpHeld) gravity *= PLAYER.lowJumpMultiplier;

    this.vy += gravity * dt;
    this.y += this.vy * dt;

    const floor = PLAYER.size / 2;
    let justLanded = false;
    if (this.y <= floor) {
      if (!this.grounded) {
        justLanded = true;
        this.squash = 1.35; // splat on impact, eased back out below
      }
      this.y = floor;
      this.vy = 0;
      this.grounded = true;
    }

    // Lane approach — exponential smoothing, framerate-independent.
    const targetX = LANES[this.lane];
    const t = 1 - Math.exp(-PLAYER.laneSpeed * dt);
    this.group.position.x += (targetX - this.group.position.x) * t;

    // Bank into the turn, proportional to how far off-target we still are.
    const lateralError = THREE.MathUtils.clamp((targetX - this.group.position.x) / 2.4, -1, 1);
    this.roll += (-lateralError * PLAYER.maxRoll - this.roll) * (1 - Math.exp(-12 * dt));

    // A slow tumble in the air sells the arc.
    this.spin += (this.grounded ? 0 : -5.2) * dt;
    if (this.grounded) this.spin *= Math.exp(-14 * dt);

    this.squash += (1 - this.squash) * (1 - Math.exp(-16 * dt));

    this.mesh.position.y = this.y;
    this.mesh.rotation.set(this.spin, 0, this.roll);
    this.mesh.scale.set(2 - this.squash, this.squash, 2 - this.squash);

    const altitude = this.y - floor;
    const shrink = THREE.MathUtils.clamp(1 - altitude / 5, 0.35, 1);
    this.shadow.scale.setScalar(shrink);
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = 0.55 * shrink;

    // Keep the collision box glued to the visual.
    this.box.cx = this.group.position.x;
    this.box.cy = this.y;
    this.box.cz = 0;

    return { justLanded, jumped };
  }

  /** Death pose: let the cube tumble off under its own momentum. */
  crash(dt: number): void {
    this.vy += PLAYER.gravity * dt * 0.6;
    this.y = Math.max(0.1, this.y + this.vy * dt);
    this.spin += 6 * dt;
    this.roll += 4 * dt;
    this.mesh.position.y = this.y;
    this.mesh.rotation.set(this.spin, this.spin * 0.6, this.roll);
    (this.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.6;
  }

  onCrash(): void {
    this.vy = 6;
  }

  restoreMaterial(): void {
    (this.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.12;
  }

  dispose(): void {
    for (const item of this.disposables) item.dispose();
  }
}
