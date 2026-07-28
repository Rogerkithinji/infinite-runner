/**
 * Input is normalised into *intents* (moveLeft / moveRight / jump) so the game
 * loop never has to know whether the player used a key, a swipe, or a tap.
 *
 * Discrete actions are queued rather than polled as booleans: a keypress that
 * happens between two simulation steps must not be dropped.
 */

export type Intent = "left" | "right" | "jump" | "start";

/** Horizontal travel, in CSS pixels, that commits a drag to a lane change. */
const SWIPE = 30;

export class Input {
  private readonly queue: Intent[] = [];

  private keyJumpHeld = false;
  private touchHeld = false;

  /** Swipe origin, re-armed after each committed swipe so drags can chain. */
  private originX = 0;
  private originY = 0;

  private readonly target: HTMLElement;

  constructor(target: HTMLElement) {
    this.target = target;
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    target.addEventListener("pointerdown", this.onPointerDown);
    target.addEventListener("pointermove", this.onPointerMove);
    target.addEventListener("pointerup", this.onPointerEnd);
    target.addEventListener("pointercancel", this.onPointerEnd);
    window.addEventListener("blur", this.onBlur);
  }

  /**
   * Held state — the jump arc reads this for variable jump height. A finger on
   * the glass counts as holding, so a long press on mobile gives the same tall
   * jump that holding Space does.
   */
  get jumpHeld(): boolean {
    return this.keyJumpHeld || this.touchHeld;
  }

  /** Drain the queue. The caller consumes every intent produced since last frame. */
  drain(out: Intent[]): void {
    out.length = 0;
    for (const intent of this.queue) out.push(intent);
    this.queue.length = 0;
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.target.removeEventListener("pointerdown", this.onPointerDown);
    this.target.removeEventListener("pointermove", this.onPointerMove);
    this.target.removeEventListener("pointerup", this.onPointerEnd);
    this.target.removeEventListener("pointercancel", this.onPointerEnd);
    window.removeEventListener("blur", this.onBlur);
  }

  private push(intent: Intent) {
    // Cap the queue so a key-repeat storm can't grow it without bound.
    if (this.queue.length < 8) this.queue.push(intent);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    switch (e.code) {
      case "ArrowLeft":
      case "KeyA":
        this.push("left");
        break;
      case "ArrowRight":
      case "KeyD":
        this.push("right");
        break;
      case "Space":
      case "ArrowUp":
      case "KeyW":
        e.preventDefault();
        if (!e.repeat) this.push("jump");
        this.keyJumpHeld = true;
        break;
      case "Enter":
      case "KeyR":
        this.push("start");
        break;
      default:
        return;
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    if (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW") {
      this.keyJumpHeld = false;
    }
  };

  private onBlur = () => {
    this.keyJumpHeld = false;
    this.touchHeld = false;
    this.queue.length = 0;
  };

  /**
   * Touch fires the jump on *press*, not release.
   *
   * Waiting for the finger to lift to decide "tap or swipe?" costs the length
   * of the gesture in latency — 100ms or so of the game ignoring you, which is
   * exactly the window where a jump matters. So a press always jumps, and a
   * horizontal drag additionally changes lane the moment it crosses the
   * threshold. Jumping when you meant to dodge is harmless: pylons are too tall
   * to clear anyway, so the lane change is what saves you either way.
   */
  private onPointerDown = (e: PointerEvent) => {
    this.originX = e.clientX;
    this.originY = e.clientY;
    this.touchHeld = true;
    // Keep receiving moves even if the finger slides off the canvas.
    this.target.setPointerCapture?.(e.pointerId);
    this.push("start");
    this.push("jump");
  };

  private onPointerMove = (e: PointerEvent) => {
    if (!this.touchHeld) return;

    const dx = e.clientX - this.originX;
    const dy = e.clientY - this.originY;
    if (Math.abs(dx) < SWIPE || Math.abs(dx) < Math.abs(dy)) return;

    this.push(dx > 0 ? "right" : "left");
    // Re-arm from here so one continuous drag can cross two lanes.
    this.originX = e.clientX;
    this.originY = e.clientY;
  };

  private onPointerEnd = (e: PointerEvent) => {
    this.touchHeld = false;
    if (this.target.hasPointerCapture?.(e.pointerId)) {
      this.target.releasePointerCapture(e.pointerId);
    }
  };
}
