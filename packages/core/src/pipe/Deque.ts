export class Deque<T> {
  private a: T[] = [];
  private h = 0;
  push(v: T) { this.a.push(v); }
  shift(): T | undefined {
    if (this.h >= this.a.length) return undefined;
    const v = this.a[this.h++];
    if (this.h > 64 && this.h * 2 > this.a.length) {
      this.a = this.a.slice(this.h); this.h = 0;
    }
    return v;
  }
  get length() { return this.a.length - this.h; }
  dropOldest() { void this.shift(); }
  kill() { this.a = []; }
}