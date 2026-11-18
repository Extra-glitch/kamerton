// Очередь воспроизведения без зависимостей от устройства, чтобы её можно было тестировать.

export type RepeatMode = 'off' | 'all' | 'one';

export interface QueueItem {
  qid: string;
  trackId: string;
  sourceTrackId: string;
  reason?: string;
  bucket?: string;
}

let counter = 0;
export const newQid = () => `q${Date.now().toString(36)}${(counter++).toString(36)}`;

export interface QueueState { base: QueueItem[]; order: string[]; currentQid: string | null; shuffle: boolean; repeat: RepeatMode }

export class PlayQueue {
  private base: QueueItem[] = [];
  private order: string[] = [];
  private cur: string | null = null;
  shuffle = false;
  repeat: RepeatMode = 'off';

  constructor(private rng: () => number = Math.random) {}

  get items(): QueueItem[] { const m = new Map(this.base.map((i) => [i.qid, i])); return this.order.map((q) => m.get(q)!).filter(Boolean); }
  get index(): number { return this.cur ? this.order.indexOf(this.cur) : -1; }
  get current(): QueueItem | null { return this.items[this.index] ?? null; }
  get upcoming(): QueueItem[] { return this.items.slice(this.index + 1); }

  snapshot(): QueueState { return { base: this.base, order: this.order, currentQid: this.cur, shuffle: this.shuffle, repeat: this.repeat }; }
  restore(s: QueueState) { this.base = s.base; this.order = s.order; this.cur = s.currentQid; this.shuffle = s.shuffle; this.repeat = s.repeat; }

  private shuffled(ids: string[]): string[] {
    const a = [...ids];
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(this.rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  set(items: QueueItem[], startIndex = 0) {
    this.base = items;
    const start = items[startIndex]?.qid ?? null;
    this.cur = start;
    const ids = items.map((i) => i.qid);
    this.order = this.shuffle && start ? [start, ...this.shuffled(ids.filter((q) => q !== start))] : ids;
  }

  jump(qid: string) { if (this.order.includes(qid)) this.cur = qid; }

  /** Следующий элемент. byUser: пользователь нажал кнопку, поэтому повтор трека не удерживает его. */
  peekNext(byUser: boolean): QueueItem | null {
    if (!this.cur) return null;
    if (this.repeat === 'one' && !byUser) return this.current;
    const i = this.index + 1;
    if (i < this.order.length) return this.items[i];
    return this.repeat === 'off' ? null : this.items[0] ?? null;
  }
  peekPrev(): QueueItem | null {
    if (this.index > 0) return this.items[this.index - 1];
    return this.repeat === 'all' ? this.items[this.items.length - 1] ?? null : null;
  }

  add(items: QueueItem[]) { this.base = [...this.base, ...items]; this.order = [...this.order, ...items.map((i) => i.qid)]; if (!this.cur && items[0]) this.cur = items[0].qid; }

  insertNext(item: QueueItem) {
    this.base = [...this.base, item];
    const at = this.index + 1;
    this.order = [...this.order.slice(0, at), item.qid, ...this.order.slice(at)];
    if (!this.cur) this.cur = item.qid;
  }

  remove(qid: string) {
    const i = this.order.indexOf(qid);
    if (i < 0) return;
    if (this.cur === qid) this.cur = this.order[i + 1] ?? this.order[i - 1] ?? null;
    this.order = this.order.filter((q) => q !== qid);
    this.base = this.base.filter((b) => b.qid !== qid);
  }

  move(qid: string, delta: number) {
    const i = this.order.indexOf(qid);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= this.order.length) return;
    const o = [...this.order];
    o.splice(i, 1);
    o.splice(j, 0, qid);
    this.order = o;
  }

  clearUpcoming() {
    const keep = new Set(this.order.slice(0, this.index + 1));
    this.order = this.order.filter((q) => keep.has(q));
    this.base = this.base.filter((b) => keep.has(b.qid));
  }

  setShuffle(on: boolean) {
    if (on === this.shuffle) return;
    this.shuffle = on;
    const played = this.order.slice(0, this.index + 1);
    if (on) {
      const rest = this.order.slice(this.index + 1);
      this.order = [...played, ...this.shuffled(rest)];
    } else {
      this.order = this.base.map((b) => b.qid);
    }
  }

  cycleRepeat(): RepeatMode { this.repeat = this.repeat === 'off' ? 'all' : this.repeat === 'all' ? 'one' : 'off'; return this.repeat; }
}
