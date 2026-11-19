// Логика плеера: очередь, окно треков в нативном плейлисте, история и обработка ошибок.
// Устройство подключается через AudioDriver, поэтому логику можно проверять тестами.

import type { PlayRecord, SourceTrack, TrackView } from '@/core/types';
import { newQid, PlayQueue, type QueueItem, type QueueState, type RepeatMode } from './queue';

export interface DriverTrack { key: string; uri: string; headers?: Record<string, string> }
export interface NowPlayingInfo { title: string; artist: string; album?: string; artworkUrl?: string; isLive?: boolean }

export interface DriverStatus { index: number; positionSec: number; durationSec: number; playing: boolean; buffering: boolean; loaded: boolean; didFinish: boolean }

export interface AudioDriver {
  load(tracks: DriverTrack[], index: number): void;
  append(track: DriverTrack): void;
  removeAt(index: number): void;
  skipTo(index: number): void;
  play(): void;
  pause(): void;
  seek(sec: number): Promise<void>;
  setVolume(v: number): void;
  setLoop(mode: 'none' | 'single' | 'all'): void;
  setNowPlaying(info: NowPlayingInfo): void;
  onStatus(cb: (s: DriverStatus) => void): void;
  onTrackChange(cb: (from: number, to: number) => void): void;
  onError?(cb: (message: string) => void): void;
}

export interface PlayerDeps {
  driver: AudioDriver;
  getViews(ids: string[]): Promise<TrackView[]>;
  resolve(s: SourceTrack): Promise<{ uri: string; headers?: Record<string, string>; quality?: SourceTrack['quality'] }>;
  recordPlay(p: PlayRecord, bucket?: string): Promise<void>;
  saveState(s: PersistedPlayer): Promise<void>;
  onStarted?(s: SourceTrack): void;
  onFinished?(s: SourceTrack): void;
  markUnavailable?(sourceTrackId: string): Promise<void>;
  refill?(ctx: string, queue: QueueItem[]): Promise<QueueItem[]>;
  now?(): number;
}

export interface PersistedPlayer { queue: QueueState; positionSec: number; context: string; }

export interface PlayerSnapshot {
  queue: QueueItem[]; index: number; current: TrackView | null; source: SourceTrack | null; quality?: SourceTrack['quality'];
  playing: boolean; buffering: boolean; positionSec: number; durationSec: number; shuffle: boolean; repeat: RepeatMode;
  context: string; error: string | null; sleepAt: number | null; fade: boolean; volume: number;
}

const WINDOW_AHEAD = 12;
const REFILL_WHEN_LEFT = 4;
const FADE_SEC = 4;

export class PlayerController {
  readonly queue: PlayQueue;
  private views = new Map<string, TrackView>();
  private window: string[] = []; // qid элементов, загруженных в нативный плейлист
  private listeners = new Set<(s: PlayerSnapshot) => void>();
  private snap: PlayerSnapshot;
  private session: { qid: string; startedAt: number; listened: number; lastPos: number } | null = null;
  private context = '';
  private sleepTimer: ReturnType<typeof setTimeout> | null = null;
  private sleepAt: number | null = null;
  private saveTick = 0;
  private refilling = false;
  private failures = 0;
  fadeEnabled = false;
  private volume = 1;
  private userVolume = 1;
  private fadeVolume = 1;

  constructor(private d: PlayerDeps, rng?: () => number) {
    this.queue = new PlayQueue(rng);
    this.snap = this.emptySnap();
    d.driver.onStatus((s) => this.handleStatus(s));
    d.driver.onTrackChange((_f, to) => { void this.handleTrackChange(to); });
    d.driver.onError?.((m) => { void this.handleError(m); });
  }

  private now() { return this.d.now?.() ?? Date.now(); }
  private emptySnap(): PlayerSnapshot {
    return { queue: [], index: -1, current: null, source: null, playing: false, buffering: false, positionSec: 0, durationSec: 0, shuffle: false, repeat: 'off', context: '', error: null, sleepAt: null, fade: false, volume: 1 };
  }

  subscribe(cb: (s: PlayerSnapshot) => void) { this.listeners.add(cb); cb(this.snap); return () => { this.listeners.delete(cb); }; }
  get state() { return this.snap; }
  private publish(patch: Partial<PlayerSnapshot> = {}) {
    const item = this.queue.current;
    const current = item ? this.views.get(item.trackId) ?? null : null;
    const source = current?.sources.find((s) => s.id === item!.sourceTrackId) ?? current?.preferred ?? null;
    this.snap = { ...this.snap, queue: this.queue.items, index: this.queue.index, current, source, shuffle: this.queue.shuffle, repeat: this.queue.repeat, context: this.context, sleepAt: this.sleepAt, fade: this.fadeEnabled, ...patch };
    for (const l of this.listeners) l(this.snap);
  }

  private async remember(items: QueueItem[]) {
    const missing = items.map((i) => i.trackId).filter((id) => !this.views.has(id));
    for (const v of await this.d.getViews(missing)) this.views.set(v.id, v);
  }

  private sourceOf(i: QueueItem): SourceTrack | null {
    const v = this.views.get(i.trackId);
    return v?.sources.find((s) => s.id === i.sourceTrackId) ?? v?.preferred ?? null;
  }

  private async driverTrack(i: QueueItem): Promise<DriverTrack | null> {
    const s = this.sourceOf(i);
    if (!s) return null;
    try { const r = await this.d.resolve(s); return { key: i.qid, uri: r.uri, headers: r.headers }; }
    catch { return null; }
  }

  /** Загружает окно очереди начиная с текущего трека. */
  private async loadWindow(startSec = 0, autoplay = true) {
    const items = this.queue.items.slice(this.queue.index, this.queue.index + WINDOW_AHEAD);
    await this.remember(items);
    const tracks: DriverTrack[] = [];
    const unplayable: string[] = [];
    for (const it of items) {
      const t = await this.driverTrack(it);
      if (t) tracks.push(t); else unplayable.push(it.qid);
    }
    for (const q of unplayable) this.queue.remove(q);
    if (!tracks.length) { this.publish({ error: 'Этот трек сейчас нельзя воспроизвести.', playing: false }); return; }
    this.window = tracks.map((t) => t.key);
    this.queue.jump(this.window[0]);
    this.d.driver.load(tracks, 0);
    this.applyLoop();
    if (startSec > 0) await this.d.driver.seek(startSec);
    this.beginSession();
    this.announce();
    if (autoplay) this.d.driver.play();
    this.publish({ error: null, positionSec: startSec });
    void this.maybeRefill();
  }

  /** Обновляет хвост окна после изменения очереди, не прерывая текущий трек. */
  private async syncWindow() {
    const cur = this.queue.current;
    if (!cur) return;
    const at = this.window.indexOf(cur.qid);
    if (at < 0) { await this.loadWindow(this.snap.positionSec, this.snap.playing); return; }
    for (let i = this.window.length - 1; i > at; i--) this.d.driver.removeAt(i);
    this.window = this.window.slice(0, at + 1);
    const next = this.queue.upcoming.slice(0, WINDOW_AHEAD - 1);
    await this.remember(next);
    for (const it of next) {
      const t = await this.driverTrack(it);
      if (t) { this.d.driver.append(t); this.window.push(t.key); }
    }
    this.publish();
  }

  private applyLoop() {
    const r = this.queue.repeat;
    // Повтор всей очереди ведём сами: в нативном плейлисте лежит только окно.
    this.d.driver.setLoop(r === 'one' ? 'single' : 'none');
  }

  private announce() {
    const item = this.queue.current;
    const v = item && this.views.get(item.trackId);
    const s = item && this.sourceOf(item);
    if (!v) return;
    if (s) this.d.onStarted?.(s);
    this.d.driver.setNowPlaying({ title: v.title, artist: v.artist, album: v.album, artworkUrl: s?.coverUrl ?? v.coverUrl, isLive: s?.isLive });
  }

  private beginSession() {
    const q = this.queue.current?.qid;
    this.session = q ? { qid: q, startedAt: this.now(), listened: 0, lastPos: 0 } : null;
  }

  private async closeSession(completed: boolean, skipped: boolean) {
    const s = this.session;
    this.session = null;
    if (!s) return;
    const item = this.queue.items.find((i) => i.qid === s.qid);
    const v = item && this.views.get(item.trackId);
    if (!item || !v) return;
    const src = this.sourceOf(item);
    if (src?.isLive || s.listened < 1) return;
    const durationMs = (v.durationSec ?? this.snap.durationSec ?? 0) * 1000;
    const listenedMs = s.listened * 1000;
    const finished = completed || (durationMs > 0 && listenedMs / durationMs >= 0.9);
    await this.d.recordPlay({ trackId: v.id, sourceTrackId: item.sourceTrackId, startedAt: s.startedAt, listenedMs, durationMs, completed: finished, skipped: skipped && !finished, context: this.context }, item.bucket);
    if (finished && src) this.d.onFinished?.(src);
  }

  private handleStatus(st: DriverStatus) {
    const s = this.session;
    if (s && st.playing) {
      const dt = st.positionSec - s.lastPos;
      if (dt > 0 && dt < 3) s.listened += dt; // перемотка не считается прослушиванием
    }
    if (s) s.lastPos = st.positionSec;
    this.applyFade(st);
    this.publish({ playing: st.playing, buffering: st.buffering, positionSec: st.positionSec, durationSec: st.durationSec || this.snap.current?.durationSec || 0 });
    if (st.playing) this.failures = 0;
    if (st.didFinish && this.queue.peekNext(false) === null) void this.finishQueue();
    else if (st.didFinish && st.index === this.window.length - 1 && this.queue.repeat !== 'one') void this.next(false);
    if (++this.saveTick % 10 === 0) void this.persist();
  }

  private applyFade(st: DriverStatus) {
    if (!this.fadeEnabled || !st.durationSec || this.sourceOfCurrentLive()) { this.fadeVolume = 1; this.applyVolume(); return; }
    const left = st.durationSec - st.positionSec;
    this.fadeVolume = Math.min(1, Math.max(0.05, Math.min(left / FADE_SEC, (st.positionSec + 0.3) / FADE_SEC)));
    this.applyVolume();
  }
  private sourceOfCurrentLive() { const i = this.queue.current; return !!(i && this.sourceOf(i)?.isLive); }
  private applyVolume() {
    const v = this.userVolume * this.fadeVolume;
    if (Math.abs(v - this.volume) > 0.02 || (v === 1 && this.volume !== 1)) { this.volume = v; this.d.driver.setVolume(v); }
  }

  private async finishQueue() {
    await this.closeSession(true, false);
    if (this.d.refill) {
      const more = await this.d.refill(this.context, this.queue.items).catch(() => []);
      if (more.length) { await this.remember(more); this.queue.add(more); await this.next(false, true); return; }
    }
    this.d.driver.pause();
    this.publish({ playing: false });
  }

  private async handleTrackChange(nativeIndex: number) {
    const qid = this.window[nativeIndex];
    if (!qid || qid === this.queue.current?.qid) return;
    const forward = this.queue.items.findIndex((i) => i.qid === qid) > this.queue.index;
    // Переход мог произойти с экрана блокировки или автоматически в конце трека.
    const wasNearEnd = this.snap.durationSec > 0 && this.snap.positionSec >= this.snap.durationSec - 2;
    await this.closeSession(forward && wasNearEnd, forward && !wasNearEnd);
    this.queue.jump(qid);
    this.beginSession();
    this.announce();
    this.publish({ positionSec: 0, durationSec: this.snap.current?.durationSec ?? 0 });
    await this.topUpWindow();
    void this.maybeRefill();
    void this.persist();
  }

  private async topUpWindow() {
    const at = this.window.indexOf(this.queue.current?.qid ?? '');
    if (at < 0) return;
    const have = this.window.length - at - 1;
    if (have >= WINDOW_AHEAD / 2) return;
    const pending = this.queue.upcoming.filter((i) => !this.window.includes(i.qid)).slice(0, WINDOW_AHEAD - have);
    await this.remember(pending);
    for (const it of pending) {
      const t = await this.driverTrack(it);
      if (t) { this.d.driver.append(t); this.window.push(t.key); }
    }
  }

  private async maybeRefill() {
    if (!this.d.refill || this.refilling || this.queue.upcoming.length > REFILL_WHEN_LEFT) return;
    this.refilling = true;
    try {
      const more = await this.d.refill(this.context, this.queue.items);
      if (more.length) { await this.remember(more); this.queue.add(more); await this.topUpWindow(); this.publish(); }
    } catch { /* следующая попытка будет при смене трека */ } finally { this.refilling = false; }
  }

  private async handleError(message: string) {
    const item = this.queue.current;
    this.failures++;
    if (item) await this.d.markUnavailable?.(item.sourceTrackId);
    this.window = []; // после ошибки нативный плеер не продолжит сам: следующий запуск соберёт его заново
    const error = `Не удалось воспроизвести: ${message}`;
    this.publish({ error, playing: false });
    // Несколько ошибок подряд обычно означают отсутствие сети: не перебираем всю очередь.
    if (this.failures < 3 && this.queue.peekNext(true)) { await this.next(true); this.publish({ error }); }
  }

  // ---------- Команды ----------

  async playList(items: { trackId: string; sourceTrackId?: string; reason?: string; bucket?: string }[], start = 0, context = '') {
    await this.closeSession(false, true);
    const views = await this.d.getViews(items.map((i) => i.trackId));
    for (const v of views) this.views.set(v.id, v);
    const q: QueueItem[] = [];
    let startIdx = 0;
    items.forEach((it, i) => {
      const v = this.views.get(it.trackId);
      const sid = it.sourceTrackId ?? v?.preferred?.id;
      if (!v || !sid) return;
      if (i === start) startIdx = q.length;
      q.push({ qid: newQid(), trackId: it.trackId, sourceTrackId: sid, reason: it.reason, bucket: it.bucket });
    });
    if (!q.length) { this.publish({ error: 'В этом списке нет треков, доступных для воспроизведения.' }); return; }
    this.context = context;
    this.queue.set(q, startIdx);
    await this.loadWindow();
  }

  toggle() { if (this.snap.playing) this.d.driver.pause(); else if (this.window.length) this.d.driver.play(); else if (this.queue.current) void this.loadWindow(this.snap.positionSec); }
  pause() { this.d.driver.pause(); }
  async seek(sec: number) { await this.d.driver.seek(sec); if (this.session) this.session.lastPos = sec; this.publish({ positionSec: sec }); }

  async next(byUser = true, afterRefill = false) {
    const target = this.queue.peekNext(byUser);
    if (!target) { if (!afterRefill) await this.finishQueue(); return; }
    await this.closeSession(!byUser, byUser);
    this.queue.jump(target.qid);
    const at = this.window.indexOf(target.qid);
    if (at >= 0) {
      this.d.driver.skipTo(at);
      if (!byUser) this.d.driver.play(); // после конца окна плеер стоит и сам не продолжит
      this.beginSession(); this.announce(); this.publish({ positionSec: 0 }); await this.topUpWindow(); void this.maybeRefill();
    } else await this.loadWindow(0, byUser || this.snap.playing || !afterRefill);
  }

  async previous() {
    if (this.snap.positionSec > 4) { await this.seek(0); return; }
    const target = this.queue.peekPrev();
    if (!target) { await this.seek(0); return; }
    await this.closeSession(false, false);
    this.queue.jump(target.qid);
    const at = this.window.indexOf(target.qid);
    if (at >= 0) { this.d.driver.skipTo(at); this.beginSession(); this.announce(); this.publish({ positionSec: 0 }); }
    else await this.loadWindow();
  }

  async jumpTo(qid: string) {
    await this.closeSession(false, true);
    this.queue.jump(qid);
    const at = this.window.indexOf(qid);
    if (at >= 0) { this.d.driver.skipTo(at); this.beginSession(); this.announce(); this.d.driver.play(); this.publish({ positionSec: 0 }); await this.topUpWindow(); }
    else await this.loadWindow();
  }

  private item(trackId: string, sourceTrackId?: string, reason?: string): QueueItem | null {
    const v = this.views.get(trackId);
    const sid = sourceTrackId ?? v?.preferred?.id;
    return sid ? { qid: newQid(), trackId, sourceTrackId: sid, reason } : null;
  }

  async playNext(trackId: string) {
    await this.remember([{ qid: '', trackId, sourceTrackId: '' }]);
    const i = this.item(trackId);
    if (!i) return;
    const empty = !this.queue.current;
    this.queue.insertNext(i);
    if (empty) await this.loadWindow(); else await this.syncWindow();
  }
  async addToQueue(trackIds: string[]) {
    await this.remember(trackIds.map((trackId) => ({ qid: '', trackId, sourceTrackId: '' })));
    const items = trackIds.map((id) => this.item(id)).filter((x): x is QueueItem => !!x);
    const empty = !this.queue.current;
    this.queue.add(items);
    if (empty) await this.loadWindow(); else { await this.topUpWindow(); this.publish(); }
  }
  async removeFromQueue(qid: string) {
    const isCurrent = this.queue.current?.qid === qid;
    if (isCurrent) { await this.next(true); }
    this.queue.remove(qid);
    await this.syncWindow();
    this.publish();
  }
  async moveInQueue(qid: string, delta: number) { this.queue.move(qid, delta); await this.syncWindow(); }
  async clearUpcoming() { this.queue.clearUpcoming(); await this.syncWindow(); }
  /** Новый порядок следующих треков: текущий продолжает играть. */
  async replaceUpcoming(items: { trackId: string; sourceTrackId?: string; reason?: string }[]) {
    await this.remember(items.map((i) => ({ qid: '', trackId: i.trackId, sourceTrackId: '' })));
    this.queue.clearUpcoming();
    this.queue.add(items.map((i) => this.item(i.trackId, i.sourceTrackId, i.reason)).filter((x): x is QueueItem => !!x));
    await this.syncWindow();
  }
  async setShuffle(on: boolean) { this.queue.setShuffle(on); await this.syncWindow(); }
  cycleRepeat() { this.queue.cycleRepeat(); this.applyLoop(); this.publish(); void this.persist(); }

  /** Сменить источник текущей композиции, не теряя позицию. */
  async switchSource(sourceTrackId: string) {
    const cur = this.queue.current;
    if (!cur) return;
    cur.sourceTrackId = sourceTrackId;
    this.views.clear();
    await this.loadWindow(this.snap.positionSec, this.snap.playing);
  }

  invalidate(trackId: string) {
    this.views.delete(trackId);
    void this.remember([{ qid: '', trackId, sourceTrackId: '' }]).then(() => {
      // Новое название или обложка сразу видны на экране блокировки и в шторке уведомлений.
      if (this.queue.current?.trackId === trackId) this.announce();
      this.publish();
    });
  }

  /** Сбрасывает всё запомненное о треках: например, после выключения источника. */
  invalidateAll() { this.views.clear(); void this.remember(this.queue.items).then(() => this.publish()); }

  setSleepTimer(minutes: number | null) {
    if (this.sleepTimer) clearTimeout(this.sleepTimer);
    this.sleepTimer = null;
    this.sleepAt = minutes ? this.now() + minutes * 60000 : null;
    if (minutes) this.sleepTimer = setTimeout(() => { this.d.driver.pause(); this.sleepAt = null; this.publish(); }, minutes * 60000);
    this.publish();
  }
  setFade(on: boolean) { this.fadeEnabled = on; if (!on) { this.fadeVolume = 1; this.applyVolume(); } this.publish(); }
  setUserVolume(v: number) { this.userVolume = Math.max(0, Math.min(1, v)); this.applyVolume(); this.publish({ volume: this.userVolume }); }

  async persist() { await this.d.saveState({ queue: this.queue.snapshot(), positionSec: this.snap.positionSec, context: this.context }).catch(() => undefined); }

  /** Восстановление после перезапуска: трек и позиция на месте, звук не включается сам. */
  async restore(p: PersistedPlayer) {
    if (!p.queue?.currentQid) return;
    this.queue.restore(p.queue);
    this.context = p.context;
    await this.remember(this.queue.items);
    this.publish({ positionSec: p.positionSec, durationSec: this.snap.current?.durationSec ?? 0 });
    await this.loadWindow(p.positionSec, false);
    this.d.driver.pause();
  }
}
