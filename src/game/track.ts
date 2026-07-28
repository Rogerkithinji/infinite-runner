import * as THREE from "three";
import { LANES, PALETTE, WORLD } from "./config";

/**
 * The ground never actually moves.
 *
 * Scrolling a real plane forever would run into float precision problems within
 * a few minutes. Instead the geometry is static and we scroll the *texture*
 * coordinates, which wrap cleanly at 1.0 and can run for days. The rails and
 * marker posts are recycled the same way: they get pushed back by exactly one
 * spacing interval whenever they pass the camera.
 */

const TRACK_LENGTH = 320;
const TRACK_WIDTH = 7.2;
const RAIL_X = 3.6;
const POST_SPACING = 12;
const POST_COUNT = Math.ceil(TRACK_LENGTH / POST_SPACING);

function hex(color: number, alpha = 1): string {
  const c = `#${color.toString(16).padStart(6, "0")}`;
  if (alpha >= 1) return c;
  const a = Math.round(alpha * 255)
    .toString(16)
    .padStart(2, "0");
  return c + a;
}

/** A tiling grid drawn once to a canvas — cheaper and crisper than a shader here. */
function gridTexture(opts: {
  size: number;
  background: string;
  lines: { u: number; color: string; width: number }[];
  rungColor: string;
  rungWidth: number;
}): THREE.CanvasTexture {
  const { size } = opts;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = opts.background;
  ctx.fillRect(0, 0, size, size);

  // Horizontal rung at the top edge of the tile; repeats down the track.
  ctx.fillStyle = opts.rungColor;
  ctx.fillRect(0, 0, size, opts.rungWidth);

  // Vertical lane lines run the length of the tile, so they read as continuous.
  for (const line of opts.lines) {
    ctx.fillStyle = line.color;
    ctx.fillRect(Math.round(line.u * size - line.width / 2), 0, line.width, size);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function dotTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 32;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  gradient.addColorStop(0, "#ffffff");
  gradient.addColorStop(0.35, "#ffffffaa");
  gradient.addColorStop(1, "#ffffff00");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 32, 32);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export class Track {
  readonly group = new THREE.Group();

  private readonly floorTex: THREE.CanvasTexture;
  private readonly trackTex: THREE.CanvasTexture;
  private readonly posts: THREE.Mesh[] = [];
  private readonly dust: THREE.Points;
  private readonly dustSpeeds: Float32Array;
  private readonly disposables: { dispose(): void }[] = [];

  constructor() {
    // --- Wide outer floor: faint, mostly there to catch fog ------------------
    this.floorTex = gridTexture({
      size: 256,
      background: hex(PALETTE.ground),
      lines: [],
      rungColor: hex(PALETTE.grid, 0.55),
      rungWidth: 2,
    });
    this.floorTex.repeat.set(6, TRACK_LENGTH / 8);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD.groundWidth * 3, TRACK_LENGTH),
      new THREE.MeshBasicMaterial({ map: this.floorTex, color: 0x6a7080 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.z = -TRACK_LENGTH / 2 + 20;
    this.group.add(floor);
    this.track(floor.geometry, floor.material, this.floorTex);

    // --- The three playable lanes -------------------------------------------
    const u = (x: number) => (x + TRACK_WIDTH / 2) / TRACK_WIDTH;
    this.trackTex = gridTexture({
      size: 512,
      background: hex(0x14171d),
      lines: [
        { u: u(-1.2), color: hex(PALETTE.grid, 0.9), width: 3 },
        { u: u(1.2), color: hex(PALETTE.grid, 0.9), width: 3 },
        { u: u(-3.55), color: hex(PALETTE.signal), width: 6 },
        { u: u(3.55), color: hex(PALETTE.signal), width: 6 },
      ],
      rungColor: hex(PALETTE.grid),
      rungWidth: 3,
    });
    this.trackTex.repeat.set(1, TRACK_LENGTH / 4);

    const track = new THREE.Mesh(
      new THREE.PlaneGeometry(TRACK_WIDTH, TRACK_LENGTH),
      new THREE.MeshBasicMaterial({ map: this.trackTex }),
    );
    track.rotation.x = -Math.PI / 2;
    track.position.set(0, 0.01, -TRACK_LENGTH / 2 + 20);
    this.group.add(track);
    this.track(track.geometry, track.material, this.trackTex);

    // --- Rails: two long emissive strips down the edges ----------------------
    const railGeo = new THREE.BoxGeometry(0.12, 0.12, TRACK_LENGTH);
    const railMat = new THREE.MeshBasicMaterial({ color: PALETTE.signal });
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(railGeo, railMat);
      rail.position.set(side * RAIL_X, 0.06, -TRACK_LENGTH / 2 + 20);
      this.group.add(rail);
    }
    this.track(railGeo, railMat);

    // --- Marker posts: recycled rather than respawned ------------------------
    const postGeo = new THREE.BoxGeometry(0.16, 1.5, 0.16);
    const postMat = new THREE.MeshBasicMaterial({ color: PALETTE.grid });
    for (let i = 0; i < POST_COUNT; i++) {
      for (const side of [-1, 1]) {
        const post = new THREE.Mesh(postGeo, postMat);
        post.position.set(side * (RAIL_X + 1.1), 0.75, WORLD.despawnZ - i * POST_SPACING);
        this.group.add(post);
        this.posts.push(post);
      }
    }
    this.track(postGeo, postMat);

    // --- Dust motes drifting past the camera --------------------------------
    const DUST = 260;
    const positions = new Float32Array(DUST * 3);
    this.dustSpeeds = new Float32Array(DUST);
    for (let i = 0; i < DUST; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 26;
      positions[i * 3 + 1] = Math.random() * 9;
      positions[i * 3 + 2] = -Math.random() * TRACK_LENGTH * 0.4;
      this.dustSpeeds[i] = 0.4 + Math.random() * 0.9;
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const dustTex = dotTexture();
    const dustMat = new THREE.PointsMaterial({
      size: 0.13,
      map: dustTex,
      color: PALETTE.bone,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.dust = new THREE.Points(dustGeo, dustMat);
    this.group.add(this.dust);
    this.track(dustGeo, dustMat, dustTex);

    // --- Horizon slab: a warm bar sitting where the fog swallows the track ---
    const horizonCanvas = document.createElement("canvas");
    horizonCanvas.width = 4;
    horizonCanvas.height = 128;
    const hctx = horizonCanvas.getContext("2d")!;
    const grad = hctx.createLinearGradient(0, 128, 0, 0);
    grad.addColorStop(0, hex(PALETTE.signal, 0.55));
    grad.addColorStop(0.25, hex(PALETTE.signal, 0.16));
    grad.addColorStop(1, hex(PALETTE.signal, 0));
    hctx.fillStyle = grad;
    hctx.fillRect(0, 0, 4, 128);
    const horizonTex = new THREE.CanvasTexture(horizonCanvas);
    horizonTex.colorSpace = THREE.SRGBColorSpace;
    const horizonGeo = new THREE.PlaneGeometry(160, 26);
    const horizonMat = new THREE.MeshBasicMaterial({
      map: horizonTex,
      transparent: true,
      depthWrite: false,
      fog: false,
      blending: THREE.AdditiveBlending,
    });
    const horizon = new THREE.Mesh(horizonGeo, horizonMat);
    horizon.position.set(0, 8, -WORLD.fogFar - 6);
    this.group.add(horizon);
    this.track(horizonGeo, horizonMat, horizonTex);

    // Lane-centre glow strips, so the active lanes read at a glance.
    const glowGeo = new THREE.PlaneGeometry(1.9, TRACK_LENGTH);
    const glowMat = new THREE.MeshBasicMaterial({
      color: PALETTE.signal,
      transparent: true,
      opacity: 0.045,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    for (const laneX of LANES) {
      const glow = new THREE.Mesh(glowGeo, glowMat);
      glow.rotation.x = -Math.PI / 2;
      glow.position.set(laneX, 0.02, -TRACK_LENGTH / 2 + 20);
      this.group.add(glow);
    }
    this.track(glowGeo, glowMat);
  }

  private track(...items: ({ dispose(): void } | undefined)[]) {
    for (const item of items) if (item) this.disposables.push(item);
  }

  update(dt: number, speed: number): void {
    const distance = speed * dt;

    // Texture scroll: `repeat.y` tiles per plane length, so one world unit of
    // travel is `repeat.y / length` of a UV unit. The modulo keeps it bounded.
    this.trackTex.offset.y = (this.trackTex.offset.y - distance / 4) % 1;
    this.floorTex.offset.y = (this.floorTex.offset.y - distance / 8) % 1;

    // Posts march forward and wrap around behind the camera.
    for (const post of this.posts) {
      post.position.z += distance;
      if (post.position.z > WORLD.despawnZ) {
        post.position.z -= POST_COUNT * POST_SPACING;
      }
    }

    // Dust drifts at varying speeds for a cheap parallax read.
    const positions = this.dust.geometry.attributes.position as THREE.BufferAttribute;
    const array = positions.array as Float32Array;
    for (let i = 0; i < this.dustSpeeds.length; i++) {
      const zi = i * 3 + 2;
      array[zi] += distance * this.dustSpeeds[i];
      if (array[zi] > WORLD.despawnZ) {
        array[zi] -= TRACK_LENGTH * 0.4;
        array[i * 3] = (Math.random() - 0.5) * 26;
        array[i * 3 + 1] = Math.random() * 9;
      }
    }
    positions.needsUpdate = true;
  }

  reset(): void {
    this.trackTex.offset.y = 0;
    this.floorTex.offset.y = 0;
  }

  dispose(): void {
    for (const item of this.disposables) item.dispose();
  }
}
