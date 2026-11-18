// Рекомендации на устройстве: метаданные + история взаимодействий. Без внешних нейросетей.

import { normalizeText, primaryArtist } from '@/core/text';
import { effectiveExplicit, type VersionFilter } from '@/core/choose';
import type { DiscoveryBucket, PlayRecord, Reaction, Recommendation, TrackView } from '@/core/types';

const DAY = 86_400_000;
const HALF_LIFE_DAYS = 30;

export type Rng = () => number;

export function seededRng(seed: number): Rng {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const artistKey = (name: string) => normalizeText(primaryArtist(name));

export function featuresOf(t: TrackView): Map<string, number> {
  const f = new Map<string, number>();
  if (t.mlRestricted) return f; // данные Spotify в модель не попадают
  f.set(`a:${artistKey(t.artist)}`, 1);
  for (const tag of t.tags.slice(0, 10)) { const n = normalizeText(tag); if (n) f.set(`t:${n}`, 0.6); }
  if (t.mood) f.set(`m:${normalizeText(t.mood)}`, 0.3);
  if (t.year) f.set(`d:${Math.floor(t.year / 10) * 10}`, 0.2);
  if (t.bpm) f.set(`b:${Math.round(t.bpm / 10) * 10}`, 0.15);
  return f;
}

export interface Signals {
  plays: PlayRecord[];
  reactions: Reaction[];
  saves: { trackId: string; imported: boolean; at: number }[];
  seedTags: string[];
  seedArtists: string[];
}

export interface Profile {
  weights: Map<string, number>;
  playedTracks: Map<string, { count: number; last: number }>;
  playedArtists: Set<string>;
  hidden: Set<string>;
  disliked: Set<string>;
  bannedArtists: Set<string>;
  interactions: number;
}

const REACTION_WEIGHT: Record<Reaction['kind'], number> = { like: 3, more: 2.5, less: -2, dislike: -3, hide: -5 };

export function playWeight(p: PlayRecord): number {
  const ratio = p.durationMs > 0 ? p.listenedMs / p.durationMs : 0;
  if (p.skipped && p.listenedMs < 30_000) return -1.5;
  if (p.completed || ratio >= 0.8) return 1;
  return ratio >= 0.4 ? 0.3 : 0;
}

export function buildProfile(s: Signals, tracks: Map<string, TrackView>, now = Date.now()): Profile {
  const weights = new Map<string, number>();
  const add = (trackId: string, value: number, at: number) => {
    const t = tracks.get(trackId);
    if (!t) return;
    const decay = 0.5 ** ((now - at) / DAY / HALF_LIFE_DAYS);
    for (const [f, w] of featuresOf(t)) weights.set(f, (weights.get(f) ?? 0) + value * w * decay);
  };
  const playedTracks = new Map<string, { count: number; last: number }>();
  const playedArtists = new Set<string>();
  // Новизна определяется только настоящими прослушиваниями, а не наличием трека в плейлисте.
  for (const p of s.plays) {
    if (p.listenedMs < 5_000) continue;
    const e = playedTracks.get(p.trackId) ?? { count: 0, last: 0 };
    e.count++;
    e.last = Math.max(e.last, p.startedAt);
    playedTracks.set(p.trackId, e);
    const t = tracks.get(p.trackId);
    if (t) playedArtists.add(artistKey(t.artist));
    add(p.trackId, playWeight(p), p.startedAt);
  }
  for (const [id, e] of playedTracks) if (e.count > 1) add(id, Math.min(1.5, 0.5 * (e.count - 1)), e.last);
  const hidden = new Set<string>();
  const disliked = new Set<string>();
  const artistDislikes = new Map<string, number>();
  for (const r of s.reactions) {
    add(r.trackId, REACTION_WEIGHT[r.kind], r.at);
    if (r.kind === 'hide') hidden.add(r.trackId);
    if (r.kind === 'dislike') {
      disliked.add(r.trackId);
      const t = tracks.get(r.trackId);
      if (t) { const k = artistKey(t.artist); artistDislikes.set(k, (artistDislikes.get(k) ?? 0) + 1); }
    }
  }
  for (const v of s.saves) add(v.trackId, v.imported ? 0.5 : 2, v.at);
  for (const tag of s.seedTags) { const k = `t:${normalizeText(tag)}`; weights.set(k, (weights.get(k) ?? 0) + 1.2); }
  for (const a of s.seedArtists) { const k = `a:${artistKey(a)}`; weights.set(k, (weights.get(k) ?? 0) + 1.5); }
  const bannedArtists = new Set([...artistDislikes].filter(([, n]) => n >= 2).map(([k]) => k));
  return { weights, playedTracks, playedArtists, hidden, disliked, bannedArtists, interactions: s.plays.length + s.reactions.length + s.saves.length };
}

export function scoreTrack(t: TrackView, p: Profile): number {
  let sum = 0;
  let norm = 0;
  for (const [f, w] of featuresOf(t)) { sum += w * (p.weights.get(f) ?? 0); norm += w * w; }
  return norm ? sum / Math.sqrt(norm) : 0;
}

export interface PoolStats { rareBelow: Map<string, number> }

export function poolStats(pool: TrackView[]): PoolStats {
  const bySource = new Map<string, number[]>();
  for (const t of pool) {
    const s = t.preferred?.source;
    if (s && t.popularity != null) bySource.set(s, [...(bySource.get(s) ?? []), t.popularity]);
  }
  const rareBelow = new Map<string, number>();
  for (const [s, v] of bySource) if (v.length >= 8) rareBelow.set(s, v.sort((a, b) => a - b)[Math.floor(v.length * 0.3)]);
  return { rareBelow };
}

export function bucketOf(t: TrackView, p: Profile, stats: PoolStats, now = Date.now()): DiscoveryBucket {
  if (p.playedTracks.has(t.id)) return 'familiar';
  if (t.releaseDate) {
    const age = now - Date.parse(t.releaseDate);
    if (age >= 0 && age < 120 * DAY) return 'fresh';
  }
  const limit = t.preferred ? stats.rareBelow.get(t.preferred.source) : undefined;
  if (limit !== undefined && t.popularity != null && t.popularity <= limit) return 'rare';
  return p.playedArtists.has(artistKey(t.artist)) ? 'new_for_you' : 'new_artist';
}

export function explain(t: TrackView, bucket: DiscoveryBucket, p: Profile): string {
  const a = `a:${artistKey(t.artist)}`;
  const shared = t.tags.filter((x) => (p.weights.get(`t:${normalizeText(x)}`) ?? 0) > 0.2).slice(0, 2);
  const tagText = shared.join(' и ');
  const likesArtist = (p.weights.get(a) ?? 0) > 0.5;
  switch (bucket) {
    case 'familiar': return likesArtist ? `Часто слушаете: ${primaryArtist(t.artist)}` : 'Вы уже слушали это, и трек вам подошёл';
    case 'fresh': return likesArtist ? `Новый релиз исполнителя, который вам нравится` : shared.length ? `Вышло недавно, близко к вашему: ${tagText}` : 'Вышло недавно';
    case 'rare': return shared.length ? `Малоизвестная находка: ${tagText}` : 'Малоизвестная находка из каталога';
    case 'new_artist': return shared.length ? `Новый для вас исполнитель, тема: ${tagText}` : 'Новый для вас исполнитель';
    default: return likesArtist ? `Новый для вас трек любимого исполнителя` : shared.length ? `Вы этого не слышали, близкая тема: ${tagText}` : 'Вы ещё этого не слышали';
  }
}

/** Гамма-распределение (Марсалья и Цанг) нужно для выборки из бета-распределения. */
function gamma(shape: number, rng: Rng): number {
  if (shape < 1) return gamma(shape + 1, rng) * rng() ** (1 / shape);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number, v: number;
    do {
      const u1 = rng() || 1e-9; const u2 = rng();
      x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      v = 1 + c * x;
    } while (v <= 0);
    v = v ** 3;
    const u = rng() || 1e-9;
    if (Math.log(u) < 0.5 * x * x + d - d * v + d * Math.log(v)) return d * v;
  }
}
export function sampleBeta(a: number, b: number, rng: Rng): number {
  const x = gamma(a, rng);
  return x / (x + gamma(b, rng));
}

const ALL_BUCKETS: DiscoveryBucket[] = ['familiar', 'new_for_you', 'fresh', 'rare', 'new_artist'];

/** discovery: 0 — знакомое, 0.5 — баланс, 1 — максимум открытий. */
export function bucketWeights(discovery: number): Record<DiscoveryBucket, number> {
  const d = Math.max(0, Math.min(1, discovery));
  return { familiar: 1.5 * (1 - d) + 0.05, new_for_you: 0.5 + 0.5 * d, fresh: 0.25 + 0.5 * d, rare: 0.1 + 0.9 * d, new_artist: 0.15 + 1.1 * d };
}

export interface WaveOptions {
  count: number;
  discovery: number;
  bandit: Record<string, { alpha: number; beta: number }>;
  versionFilter: VersionFilter;
  exclude?: Set<string>;
  recentArtists?: string[];
  now?: number;
  rng?: Rng;
  cooldownHours?: number;
  onlyBuckets?: DiscoveryBucket[];
}

function eligible(t: TrackView, p: Profile, o: WaveOptions, now: number): boolean {
  if (!t.preferred || t.preferred.availability !== 'full' || t.preferred.isLive) return false;
  if (p.hidden.has(t.id) || p.disliked.has(t.id) || p.bannedArtists.has(artistKey(t.artist)) || o.exclude?.has(t.id)) return false;
  if ((t.durationSec ?? 120) < 45) return false; // короткие обрывки не считаем песнями
  const played = p.playedTracks.get(t.id);
  if (played && now - played.last < (o.cooldownHours ?? 48) * 3_600_000) return false;
  const version = effectiveExplicit(t.preferred);
  if (o.versionFilter === 'clean_only' && version === 'explicit') return false;
  return true;
}

export function buildWave(pool: TrackView[], p: Profile, o: WaveOptions): Recommendation[] {
  const rng = o.rng ?? Math.random;
  const now = o.now ?? Date.now();
  const stats = poolStats(pool);
  const buckets = new Map<DiscoveryBucket, { t: TrackView; s: number }[]>();
  for (const t of pool) {
    if (!eligible(t, p, o, now)) continue;
    let s = scoreTrack(t, p);
    // Цензурированная версия опускается вниз, но ничего не подменяет.
    if (o.versionFilter === 'original_first' && effectiveExplicit(t.preferred!) === 'clean') s -= 2;
    if (t.versionTags.some((v) => v === 'karaoke' || v === 'nightcore' || v === 'sped_up' || v === 'slowed')) s -= 1;
    const b = bucketOf(t, p, stats, now);
    if (o.onlyBuckets && !o.onlyBuckets.includes(b)) continue;
    buckets.set(b, [...(buckets.get(b) ?? []), { t, s: s + (rng() - 0.5) * 0.4 }]);
  }
  for (const list of buckets.values()) list.sort((a, b) => b.s - a.s);
  const weights = bucketWeights(o.discovery);
  const out: Recommendation[] = [];
  const recent = [...(o.recentArtists ?? [])];
  const used = new Set<string>();

  while (out.length < o.count) {
    const options = ALL_BUCKETS.filter((b) => (buckets.get(b)?.length ?? 0) > 0);
    if (!options.length) break;
    const bucket = options
      .map((b) => ({ b, v: sampleBeta((o.bandit[b]?.alpha ?? 1) + 1, (o.bandit[b]?.beta ?? 1) + 1, rng) * weights[b] }))
      .sort((x, y) => y.v - x.v)[0].b;
    const list = buckets.get(bucket)!;
    // Антиповтор: не чаще двух треков исполнителя в последних пяти и никакого повтора записи.
    const idx = list.findIndex(({ t }) => {
      const k = artistKey(t.artist);
      return !used.has(t.canonicalKey) && recent.slice(-5).filter((x) => x === k).length < 2 && recent[recent.length - 1] !== k;
    });
    if (idx < 0) { buckets.set(bucket, []); continue; }
    const { t, s } = list.splice(idx, 1)[0];
    used.add(t.canonicalKey);
    recent.push(artistKey(t.artist));
    out.push({ trackId: t.id, sourceTrackId: t.preferred!.id, bucket, score: s, reason: explain(t, bucket, p) });
  }
  return out;
}

/** «Удиви меня»: ещё не звучавшее, на краю вкуса, но не полностью случайное. */
export function surprise(pool: TrackView[], p: Profile, o: Omit<WaveOptions, 'count' | 'discovery'>, count = 12): Recommendation[] {
  const rng = o.rng ?? Math.random;
  const stats = poolStats(pool);
  const now = o.now ?? Date.now();
  const scored = pool
    .filter((t) => eligible(t, p, { ...o, count, discovery: 1 }, now) && !p.playedTracks.has(t.id) && !p.playedArtists.has(artistKey(t.artist)))
    .map((t) => ({ t, s: scoreTrack(t, p) }));
  if (!scored.length) return [];
  const sorted = [...scored].sort((a, b) => a.s - b.s);
  // Берём среднюю полосу: самые похожие не удивят, самые далёкие обычно не понравятся.
  const edge = sorted.slice(Math.floor(sorted.length * 0.25), Math.max(Math.floor(sorted.length * 0.8), Math.min(sorted.length, count)));
  const out: Recommendation[] = [];
  const artists = new Set<string>();
  while (edge.length && out.length < count) {
    const { t, s } = edge.splice(Math.floor(rng() * edge.length), 1)[0];
    const k = artistKey(t.artist);
    if (artists.has(k)) continue;
    artists.add(k);
    const tag = t.tags[0];
    out.push({ trackId: t.id, sourceTrackId: t.preferred!.id, bucket: bucketOf(t, p, stats, now), score: s, reason: tag ? `Вне привычного круга: ${tag}` : 'Вне привычного круга' });
  }
  return out;
}

export interface SimilarResult { track: TrackView; score: number; reason: string }

/** Похожие композиции. radius растёт для радио: круг исполнителей постепенно расширяется. */
export function similarTo(seed: TrackView, pool: TrackView[], p: Profile, o: { radius?: number; exclude?: Set<string>; relatedArtists?: Map<string, number>; limit?: number } = {}): SimilarResult[] {
  const radius = o.radius ?? 0;
  const seedArtist = artistKey(seed.artist);
  const seedTags = new Set(seed.tags.map(normalizeText).filter(Boolean));
  const out: SimilarResult[] = [];
  for (const t of pool) {
    if (t.id === seed.id || !t.preferred || t.preferred.availability !== 'full' || t.preferred.isLive || t.canonicalKey === seed.canonicalKey) continue;
    if (p.hidden.has(t.id) || p.disliked.has(t.id) || p.bannedArtists.has(artistKey(t.artist)) || o.exclude?.has(t.id)) continue;
    const reasons: string[] = [];
    let s = 0;
    const k = artistKey(t.artist);
    if (k === seedArtist) { s += Math.max(0.1, 0.9 - radius * 0.4); reasons.push('тот же исполнитель'); }
    const rel = o.relatedArtists?.get(k);
    if (rel) { s += 0.8 * rel; reasons.push('родственный исполнитель по ListenBrainz'); }
    const tags = t.tags.map(normalizeText).filter(Boolean);
    const common = tags.filter((x) => seedTags.has(x));
    if (common.length) {
      s += (2 * common.length) / (seedTags.size + new Set(tags).size) * 2;
      reasons.push(`общая тема: ${common.slice(0, 2).join(', ')}`);
    }
    if (seed.mood && t.mood && normalizeText(seed.mood) === normalizeText(t.mood)) { s += 0.35; reasons.push(`настроение: ${t.mood}`); }
    if (seed.bpm && t.bpm && Math.abs(seed.bpm - t.bpm) <= 6) { s += 0.25; reasons.push('близкий темп'); }
    if (seed.year && t.year && Math.abs(seed.year - t.year) <= 5) s += 0.1;
    if (s <= 0.05) continue;
    s += Math.max(-0.4, Math.min(0.5, scoreTrack(t, p) * 0.15));
    if (!p.playedTracks.has(t.id)) s += 0.1;
    if (k !== seedArtist) s += radius * 0.15;
    out.push({ track: t, score: s, reason: reasons.slice(0, 2).join(', ') || 'близко по описанию' });
  }
  out.sort((a, b) => b.score - a.score);
  const perArtist = new Map<string, number>();
  const cap = radius > 0 ? 2 : 4;
  return out.filter(({ track }) => {
    const k = artistKey(track.artist);
    const n = perArtist.get(k) ?? 0;
    perArtist.set(k, n + 1);
    return n < cap;
  }).slice(0, o.limit ?? 40);
}

export const BUCKET_LABEL: Record<DiscoveryBucket, string> = {
  familiar: 'Знакомое', new_for_you: 'Новое для вас', fresh: 'Недавно вышло', rare: 'Редкая находка', new_artist: 'Новый исполнитель',
};
