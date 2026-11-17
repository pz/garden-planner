/** A plant's growing room: a disc of radius `spacingIn / 2` around its center, belonging to a group (patch). */
export interface Disc {
  x: number;
  y: number;
  spacingIn: number;
  group: string;
}

/**
 * A uniform bucket grid over discs, for finding the neighbours of a point without comparing it
 * with every plant. One index covers one bed (or any single coordinate frame). The bucket edge
 * should be about the largest query radius in play, so a query touches few buckets.
 */
export class DiscIndex {
  private readonly buckets = new Map<number, Disc[]>();
  private readonly byGroup = new Map<string, Disc[]>();

  private readonly bucketIn: number;

  constructor(bucketIn: number) {
    if (!(bucketIn > 0)) throw new Error('DiscIndex needs a bucket size above 0');
    this.bucketIn = bucketIn;
  }

  private cell(v: number): number {
    return Math.floor(v / this.bucketIn);
  }

  private key(ix: number, iy: number): number {
    return (ix + 32768) * 65536 + (iy + 32768);
  }

  get size(): number {
    let n = 0;
    for (const ds of this.byGroup.values()) n += ds.length;
    return n;
  }

  add(d: Disc): void {
    const k = this.key(this.cell(d.x), this.cell(d.y));
    const bucket = this.buckets.get(k);
    if (bucket) bucket.push(d);
    else this.buckets.set(k, [d]);
    const g = this.byGroup.get(d.group);
    if (g) g.push(d);
    else this.byGroup.set(d.group, [d]);
  }

  /** Removes every disc of a group. */
  removeGroup(group: string): void {
    const discs = this.byGroup.get(group);
    if (!discs) return;
    this.byGroup.delete(group);
    for (const d of discs) {
      const k = this.key(this.cell(d.x), this.cell(d.y));
      const bucket = this.buckets.get(k)!;
      bucket.splice(bucket.indexOf(d), 1);
      if (bucket.length === 0) this.buckets.delete(k);
    }
  }

  /** Calls `fn` for every disc whose center is within `radius` of (x, y), nearest or not, in no particular order. */
  forEachNear(x: number, y: number, radius: number, fn: (d: Disc, dist: number) => void): void {
    const r2 = radius * radius;
    for (let ix = this.cell(x - radius); ix <= this.cell(x + radius); ix++) {
      for (let iy = this.cell(y - radius); iy <= this.cell(y + radius); iy++) {
        const bucket = this.buckets.get(this.key(ix, iy));
        if (!bucket) continue;
        for (const d of bucket) {
          const dx = d.x - x;
          const dy = d.y - y;
          const d2 = dx * dx + dy * dy;
          if (d2 <= r2) fn(d, Math.sqrt(d2));
        }
      }
    }
  }
}
