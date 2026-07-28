/**
 * Input is normalised into *intents* (moveLeft / moveRight / jump) so the game
 * loop never has to know whether the player used a key, a swipe, or a tap.
 *
 * Discrete actions are queued rather than polled as booleans: a keypress that
 * happens between two simulation steps must not be dropped.
 */

export type Intent = "left" | "right" | "jump" | "start";

export class Input {
  private readonly queue: Intent[] = [];
  /** Held state — the jump arc uses this for variable jump height. */
  jumpHeld = false;

  private touchX = 0;
  private touchY = 0;
  private touchTime = 0;

  private readonly target: HTMLElement;

  constructor(target: HTMLElement) {
    this.target = target;
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    target.addEventListener("pointerdown", this.onPointerDown);
    target.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("blur", this.onBlur);
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
    this.target.removeEventListener("pointerup", this.onPointerUp);
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
        this.jumpHeld = true;
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
      this.jumpHeld = false;
    }
  };

  private onBlur = () => {
    this.jumpHeld = false;
    this.queue.length = 0;
  };

  private onPointerDown = (e: PointerEvent) => {
    this.touchX = e.clientX;
    this.touchY = e.clientY;
    this.touchTime = performance.now();
    this.jumpHeld = true;
  };

  private onPointerUp = (e: PointerEvent) => {
    this.jumpHeld = false;
    const dx = e.clientX - this.touchX;
    const dy = e.clientY - this.touchY;
    const elapsed = performance.now() - this.touchTime;
    const SWIPE = 32;

    if (elapsed < 600 && Math.abs(dx) > SWIPE && Math.abs(dx) > Math.abs(dy)) {
      this.push(dx > 0 ? "right" : "left");
    } else if (elapsed < 600 && dy < -SWIPE) {
      this.push("jump");
    } else if (Math.abs(dx) < SWIPE && Math.abs(dy) < SWIPE) {
      // A plain tap both starts a run and jumps during one.
      this.push("start");
      this.push("jump");
    }
  };
}
