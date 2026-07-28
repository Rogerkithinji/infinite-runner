/**
 * A fixed-size object pool.
 *
 * Allocating meshes mid-run is how a smooth game turns into a stuttering one:
 * `new THREE.Mesh(...)` every spawn means garbage every few seconds, and the GC
 * pause lands in the middle of a jump. So we build every obstacle up front,
 * park them off-screen, and hand the same objects out forever.
 */
export class Pool<T> {
  private readonly items: T[] = [];
  private readonly free: T[] = [];
  private readonly live = new Set<T>();

  constructor(size: number, factory: (index: number) => T) {
    for (let i = 0; i < size; i++) {
      const item = factory(i);
      this.items.push(item);
      this.free.push(item);
    }
  }

  /** Returns null when the pool is exhausted — a full pool is a design signal, not a bug. */
  acquire(): T | null {
    const item = this.free.pop();
    if (!item) return null;
    this.live.add(item);
    return item;
  }

  release(item: T): void {
    if (!this.live.delete(item)) return;
    this.free.push(item);
  }

  releaseAll(): void {
    for (const item of this.live) this.free.push(item);
    this.live.clear();
  }

  /** Iterate the checked-out items. */
  active(): Iterable<T> {
    return this.live;
  }

  get all(): readonly T[] {
    return this.items;
  }

  get liveCount(): number {
    return this.live.size;
  }
}
