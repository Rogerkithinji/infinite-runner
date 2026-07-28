import * as THREE from "three";
import { FIXED_DT, MAX_STEPS_PER_FRAME, PALETTE, SCORE, WORLD } from "./config";
import { overlaps, planarGap } from "./collision";
import { Input, type Intent } from "./input";
import { ObstacleField } from "./obstacles";
import { Player } from "./player";
import { Track } from "./track";
import { Audio } from "./audio";

export type Status = "ready" | "playing" | "over";

export type Snapshot = {
  status: Status;
  score: number;
  best: number;
  speed: number;
  /** Fastest speed reached this run — `speed` itself decays after a crash. */
  topSpeed: number;
  /** Total near misses this run — the HUD pulses when it changes. */
  nearMisses: number;
  elapsed: number;
  muted: boolean;
};

const BEST_KEY = "runner.best";

export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;

  private readonly track = new Track();
  private readonly player = new Player();
  private readonly field = new ObstacleField();
  private readonly input: Input;
  private readonly audio = new Audio();

  private readonly container: HTMLElement;
  private readonly resizeObserver: ResizeObserver;
  private readonly onSnapshot: (snapshot: Snapshot) => void;

  private readonly intents: Intent[] = [];
  private readonly keyLight: THREE.DirectionalLight;
  private readonly playerLight: THREE.PointLight;

  private frame = 0;
  private lastTime = 0;
  private accumulator = 0;
  private running = false;

  private status: Status = "ready";
  private score = 0;
  private best = 0;
  private speed: number = WORLD.startSpeed;
  private topSpeed: number = WORLD.startSpeed;
  private elapsed = 0;
  private nearMisses = 0;
  private crashTimer = 0;
  private shake = 0;
  private nextTickScore = 500;
  private lastEmit = 0;

  constructor(container: HTMLElement, onSnapshot: (snapshot: Snapshot) => void) {
    this.container = container;
    this.onSnapshot = onSnapshot;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.setClearColor(PALETTE.void, 1);
    container.appendChild(this.renderer.domElement);

    this.scene.fog = new THREE.Fog(PALETTE.void, WORLD.fogNear, WORLD.fogFar);
    this.scene.add(this.track.group, this.field.group, this.player.group);

    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 400);
    this.camera.position.set(0, 3.7, 8.4);
    this.camera.lookAt(0, 1.1, -10);

    const hemi = new THREE.HemisphereLight(0x8899bb, 0x0a0b0f, 0.7);
    this.keyLight = new THREE.DirectionalLight(PALETTE.bone, 1.5);
    this.keyLight.position.set(-6, 12, 4);
    const rim = new THREE.DirectionalLight(PALETTE.signal, 1.1);
    rim.position.set(5, 4, -14);
    this.playerLight = new THREE.PointLight(PALETTE.signal, 14, 12, 2);
    this.playerLight.position.set(0, 1.6, 1);
    this.scene.add(hemi, this.keyLight, rim, this.playerLight);

    this.input = new Input(container);

    this.best = this.loadBest();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    document.addEventListener("visibilitychange", this.onVisibility);
  }

  // ---------------------------------------------------------------- lifecycle

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.frame = requestAnimationFrame(this.tick);
    this.emit(true);
  }

  dispose(): void {
    this.running = false;
    cancelAnimationFrame(this.frame);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.resizeObserver.disconnect();
    this.input.dispose();
    this.audio.dispose();
    this.track.dispose();
    this.player.dispose();
    this.field.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  toggleMute(): void {
    this.audio.muted = !this.audio.muted;
    this.emit(true);
  }

  /** Called by the HUD buttons as well as by the input layer. */
  restart(): void {
    this.status = "playing";
    this.score = 0;
    this.speed = WORLD.startSpeed;
    this.topSpeed = WORLD.startSpeed;
    this.elapsed = 0;
    this.nearMisses = 0;
    this.crashTimer = 0;
    this.shake = 0;
    this.nextTickScore = 500;
    this.player.reset();
    this.player.restoreMaterial();
    this.field.reset();
    this.track.reset();
    this.emit(true);
  }

  private onVisibility = () => {
    // Coming back from a hidden tab, `performance.now()` has jumped by however
    // long we were away. Reset the clock so the accumulator doesn't try to
    // simulate thirty seconds of game in one frame.
    if (!document.hidden) this.lastTime = performance.now();
  };

  private resize = () => {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    // Widen the field of view on portrait screens so the lanes stay readable.
    this.camera.fov = height > width ? 78 : 62;
    this.camera.updateProjectionMatrix();
  };

  // --------------------------------------------------------------- main loop

  private tick = (now: number) => {
    if (!this.running) return;
    this.frame = requestAnimationFrame(this.tick);

    // Delta timing, the careful version. The wall-clock delta is clamped and
    // then spent in fixed-size chunks, so physics behaves identically on a
    // 60Hz laptop and a 240Hz monitor — and a single long frame can never
    // teleport the cube through an obstacle.
    const wallDelta = Math.min((now - this.lastTime) / 1000, 0.25);
    this.lastTime = now;
    this.accumulator += wallDelta;

    let steps = 0;
    while (this.accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
      this.step(FIXED_DT);
      this.accumulator -= FIXED_DT;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0;

    this.render(wallDelta);
    this.emit(false);
  };

  private step(dt: number): void {
    this.input.drain(this.intents);

    for (const intent of this.intents) {
      if (this.status === "playing") {
        if (intent === "left") this.player.move(-1);
        else if (intent === "right") this.player.move(1);
        else if (intent === "jump") this.player.requestJump();
      } else if (intent === "start" || intent === "jump") {
        if (this.status === "ready" || this.crashTimer > 0.6) this.restart();
      }
    }

    if (this.status === "playing") {
      this.elapsed += dt;
      this.speed = Math.min(WORLD.maxSpeed, this.speed + WORLD.acceleration * dt);
      this.topSpeed = Math.max(this.topSpeed, this.speed);
      this.score += this.speed * dt * SCORE.perMetre;

      if (this.score >= this.nextTickScore) {
        this.nextTickScore += 500;
        this.audio.play("tick");
      }

      const { justLanded, jumped } = this.player.update(dt, this.input.jumpHeld);
      if (jumped) this.audio.play("jump");
      if (justLanded) this.audio.play("land");

      this.field.update(dt, this.speed, this.elapsed);
      this.track.update(dt, this.speed);
      this.checkCollisions();
    } else if (this.status === "ready") {
      // Attract mode: the world idles forward so the start screen isn't static.
      const idle = WORLD.startSpeed * 0.42;
      this.track.update(dt, idle);
      this.player.update(dt, this.input.jumpHeld);
    } else {
      this.crashTimer += dt;
      // Roll to a stop rather than cutting the motion dead.
      this.speed = Math.max(0, this.speed - 26 * dt);
      this.track.update(dt, this.speed);
      this.field.update(dt, this.speed, this.elapsed);
      this.player.crash(dt);
      this.shake = Math.max(0, this.shake - dt * 1.6);
    }
  }

  private checkCollisions(): void {
    const player = this.player.box;

    for (const obstacle of this.field.active()) {
      // Cheap depth reject first: most obstacles are nowhere near the player.
      if (Math.abs(obstacle.box.cz - player.cz) > 4) continue;

      if (overlaps(player, obstacle.box)) {
        this.crash();
        return;
      }

      // Once it is behind us and was never hit, score the dodge.
      if (!obstacle.counted && obstacle.box.cz > player.cz + obstacle.box.hz + player.hz) {
        obstacle.counted = true;
        if (planarGap(player, obstacle.box) < SCORE.nearMissRadius) {
          this.nearMisses++;
          this.score += SCORE.nearMiss;
          this.shake = Math.min(0.35, this.shake + 0.12);
          this.audio.play("near");
        }
      }
    }
  }

  private crash(): void {
    this.status = "over";
    this.crashTimer = 0;
    this.shake = 1;
    this.player.onCrash();
    this.audio.play("crash");
    if (this.score > this.best) {
      this.best = Math.floor(this.score);
      this.saveBest(this.best);
    }
    this.emit(true);
  }

  // ------------------------------------------------------------------ render

  private render(dt: number): void {
    const smooth = 1 - Math.exp(-6 * dt);

    // The camera trails the cube laterally instead of locking to it — the lag
    // is what makes a lane change feel like it had weight.
    const targetX = this.player.group.position.x * 0.42;
    this.camera.position.x += (targetX - this.camera.position.x) * smooth;

    // Pull back and drop slightly as the run speeds up.
    const speedRatio = (this.speed - WORLD.startSpeed) / (WORLD.maxSpeed - WORLD.startSpeed);
    const targetZ = 8.4 + THREE.MathUtils.clamp(speedRatio, 0, 1) * 1.6;
    this.camera.position.z += (targetZ - this.camera.position.z) * smooth;

    if (this.shake > 0.001) {
      const magnitude = this.shake * 0.35;
      this.camera.position.x += (Math.random() - 0.5) * magnitude;
      this.camera.position.y += (Math.random() - 0.5) * magnitude * 0.6;
      this.shake *= Math.exp(-5 * dt);
    } else {
      this.camera.position.y += (3.7 - this.camera.position.y) * smooth;
    }

    this.camera.lookAt(this.player.group.position.x * 0.25, 1.1, -12);

    this.playerLight.position.x = this.player.group.position.x;
    this.playerLight.intensity = this.status === "over" ? 26 : 14;

    this.renderer.render(this.scene, this.camera);
  }

  // -------------------------------------------------------------- react glue

  private emit(force: boolean): void {
    const now = performance.now();
    // React does not need 120 updates a second to draw a score counter.
    if (!force && now - this.lastEmit < 60) return;
    this.lastEmit = now;
    this.onSnapshot({
      status: this.status,
      score: Math.floor(this.score),
      best: this.best,
      speed: this.speed,
      topSpeed: this.topSpeed,
      nearMisses: this.nearMisses,
      elapsed: this.elapsed,
      muted: this.audio.muted,
    });
  }

  private loadBest(): number {
    try {
      return Number(window.localStorage.getItem(BEST_KEY)) || 0;
    } catch {
      return 0;
    }
  }

  private saveBest(value: number): void {
    try {
      window.localStorage.setItem(BEST_KEY, String(value));
    } catch {
      // Private browsing. Not worth interrupting a run over.
    }
  }
}
