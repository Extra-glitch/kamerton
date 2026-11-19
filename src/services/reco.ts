// Связывает алгоритмы рекомендаций с базой и источниками.

import type { Recommendation, RemoteTrack, TrackView } from '@/core/types';
import { similarity } from '@/core/text';
import * as repo from '@/db/repo';
import { musicBrainz } from '@/meta/musicbrainz';
import { sourceContext as ctx } from '@/platform/secureConfig';
import { artistKey, buildProfile, buildWave, scoreTrack, seededRng, similarTo, surprise, type Profile, type SimilarResult } from '@/reco/engine';
import { ADAPTERS, adapter, readySources } from '@/sources/registry';
import type { DiscoverRequest } from '@/sources/types';
import { settings } from '@/state/settings';
import { relatedArtists } from '@/meta/listenbrainz';

const POOL_TTL = 6 * 3_600_000;
const YEAR = 365 * 86_400_000;
const MODES: DiscoverRequest['mode'][] = ['taste', 'fresh', 'rare', 'popular'];

export interface RecoInput { profile: Profile; pool: TrackView[]; tracks: Map<string, TrackView> }
let cache: { at: number; value: RecoInput } | null = null;
export const invalidateReco = () => { cache = null; };

export async function loadReco(force = false): Promise<RecoInput> {
  if (!force && cache && Date.now() - cache.at < 20_000) return cache.value;
  const s = settings();
  const [plays, reactions, saves, poolIds] = await Promise.all([repo.getPlays(Date.now() - YEAR), repo.getReactions(), repo.playlistSignals(), repo.poolTrackIds()]);
  const ids = new Set<string>([...poolIds, ...plays.map((p) => p.trackId), ...reactions.map((r) => r.trackId), ...saves.map((v) => v.trackId)]);
  const views = await repo.getViews([...ids]);
  const tracks = new Map(views.map((v) => [v.id, v]));
  const inPool = new Set(poolIds);
  const profile = buildProfile({ plays, reactions, saves, seedTags: s.seedTags, seedArtists: s.seedArtists }, tracks);
  cache = { at: Date.now(), value: { profile, tracks, pool: views.filter((v) => inPool.has(v.id)) } };
  return cache.value;
}

export function topFeatures(p: Profile, prefix: 'a:' | 't:', n: number): string[] {
  return [...p.weights].filter(([k, v]) => k.startsWith(prefix) && v > 0).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k.slice(2));
}

export interface PoolResult { added: number; failed: { source: string; message: string }[] }

/** Пополняет набор кандидатов из подключённых источников. */
export async function refreshPool(force = false): Promise<PoolResult> {
  const last = await repo.kvGet<number>('pool.at', 0);
  const round = await repo.kvGet<number>('pool.round', 0);
  const count = (await repo.poolTrackIds(100)).length;
  if (!force && Date.now() - last < POOL_TTL && count >= 40) return { added: 0, failed: [] };
  const { profile } = await loadReco();
  const s = settings();
  const tags = [...new Set([...topFeatures(profile, 't:', 5), ...s.seedTags])].slice(0, 6);
  const artists = [...new Set([...s.seedArtists, ...topFeatures(profile, 'a:', 3)])].slice(0, 3);
  const mode = MODES[round % MODES.length];
  const sources = (await readySources(ctx, (a) => !!a.discover && a.id !== 'local')).filter((a) => a.capabilities.mlAllowed);
  const out: PoolResult = { added: 0, failed: [] };
  await Promise.all(sources.map(async (a) => {
    try {
      const list = await a.discover!(ctx, { tags, artists, limit: 40, mode });
      const ids = await repo.upsertMany(list.filter((t) => t.availability === 'full'), { pool: true });
      out.added += ids.length;
    } catch (e) { out.failed.push({ source: a.name, message: (e as Error).message }); }
  }));
  if (out.added) { await repo.kvSet('pool.at', Date.now()); await repo.kvSet('pool.round', round + 1); invalidateReco(); }
  return out;
}

export type PlayItem = { trackId: string; sourceTrackId: string; reason: string; bucket: string };
const toItems = (r: Recommendation[]): PlayItem[] => r.map((x) => ({ trackId: x.trackId, sourceTrackId: x.sourceTrackId, reason: x.reason, bucket: x.bucket }));

async function log(recs: Recommendation[], context: string) { for (const r of recs) await repo.logRecommendation(r, context); }

async function waveOptions(exclude: string[]) {
  const s = settings();
  return { discovery: s.discovery, bandit: await repo.getBandit(), versionFilter: s.versionFilter, exclude: new Set(exclude) };
}

export async function nextWave(count = 15, exclude: string[] = [], recentArtists: string[] = [], record = true): Promise<PlayItem[]> {
  await refreshPool();
  let input = await loadReco();
  let recs = buildWave(input.pool, input.profile, { ...(await waveOptions(exclude)), count, recentArtists });
  if (recs.length < Math.min(5, count)) {
    const r = await refreshPool(true);
    if (r.added) { input = await loadReco(true); recs = buildWave(input.pool, input.profile, { ...(await waveOptions(exclude)), count, recentArtists }); }
  }
  if (record) await log(recs, 'wave');
  return toItems(recs);
}

export async function surpriseMe(count = 12, exclude: string[] = []): Promise<PlayItem[]> {
  await refreshPool();
  const { pool, profile } = await loadReco();
  const recs = surprise(pool, profile, await waveOptions(exclude), count);
  await log(recs, 'surprise');
  return toItems(recs);
}

const today = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Открытия дня: только то, что пользователь ещё не слышал. Набор не меняется в течение дня. */
export async function dailyDiscoveries(count = 7): Promise<PlayItem[]> {
  const day = today();
  const saved = await repo.getDailyPicks(day);
  if (saved.length) return saved.map((p) => ({ trackId: p.track_id, sourceTrackId: p.source_track_id, reason: p.reason, bucket: p.bucket }));
  await refreshPool();
  const { pool, profile } = await loadReco();
  const seed = day.split('-').reduce((a, x) => a * 31 + Number(x), 7);
  const recs = buildWave(pool, profile, { ...(await waveOptions([])), count, discovery: 0.9, rng: seededRng(seed), onlyBuckets: ['new_for_you', 'fresh', 'rare', 'new_artist'] });
  if (recs.length) await repo.setDailyPicks(day, recs.map((r) => ({ trackId: r.trackId, sourceTrackId: r.sourceTrackId, bucket: r.bucket, reason: r.reason })));
  await log(recs, 'daily');
  return toItems(recs);
}

async function related(seed: TrackView): Promise<Map<string, number>> {
  if (!settings().listenBrainzEnabled || !settings().musicBrainzEnabled) return new Map();
  return relatedArtists(seed.artist).catch(() => new Map());
}

/** Дополнительные кандидаты для похожих: теги и родственные исполнители. */
async function widenPool(seed: TrackView, rel: Map<string, number>) {
  const sources = (await readySources(ctx, (a) => !!a.discover && a.id !== 'local')).filter((a) => a.capabilities.mlAllowed);
  const names = [seed.artist, ...[...rel.keys()].slice(0, 2)];
  await Promise.allSettled(sources.map(async (a) => {
    const list = await a.discover!(ctx, { tags: seed.tags.slice(0, 3), artists: names, limit: 30, mode: 'rare' });
    await repo.upsertMany(list.filter((t) => t.availability === 'full'), { pool: true });
  }));
  invalidateReco();
}

export async function similarTracks(trackId: string, radius = 0, exclude: string[] = [], limit = 40): Promise<SimilarResult[]> {
  const seed = await repo.getView(trackId);
  if (!seed) return [];
  const rel = await related(seed);
  let { pool, profile } = await loadReco();
  let out = similarTo(seed, pool, profile, { radius, exclude: new Set(exclude), relatedArtists: rel, limit });
  if (out.length < 12) {
    await widenPool(seed, rel);
    ({ pool, profile } = await loadReco(true));
    out = similarTo(seed, pool, profile, { radius, exclude: new Set(exclude), relatedArtists: rel, limit });
  }
  return out;
}

export async function radioBatch(seedId: string, round: number, exclude: string[]): Promise<PlayItem[]> {
  const list = await similarTracks(seedId, Math.min(1.5, round * 0.35), exclude, 12);
  return list.map((r) => ({ trackId: r.track.id, sourceTrackId: r.track.preferred!.id, reason: r.reason, bucket: 'new_for_you' }));
}

export interface HomeData {
  wave: PlayItem[]; waveTracks: TrackView[]; daily: TrackView[]; dailyReasons: Map<string, string>; recent: TrackView[]; artists: { name: string; cover?: string }[];
  albums: { source: string; id: string; title: string; artist: string; cover?: string; reason: string }[];
  fresh: TrackView[]; likeRecent: { title: string; tracks: TrackView[] } | null; mixes: { tag: string; tracks: TrackView[] }[]; genrePopular: TrackView[];
  poolErrors: PoolResult['failed']; poolSize: number; interactions: number;
}

export async function loadHome(): Promise<HomeData> {
  const poolResult = await refreshPool();
  const dailyItems = await dailyDiscoveries();
  const wave = await nextWave(6, [], [], false); // это предпросмотр, в журнал он не идёт
  const { pool, profile, tracks } = await loadReco();
  const recentIds = await repo.recentPlayedIds(12);
  const recent = recentIds.map((id) => tracks.get(id)).filter((t): t is TrackView => !!t);
  const byScore = pool.filter((t) => t.preferred?.availability === 'full' && !t.preferred.isLive).map((t) => ({ t, s: scoreTrack(t, profile) })).sort((a, b) => b.s - a.s);
  const artistNames = new Map<string, { name: string; cover?: string }>();
  for (const t of tracks.values()) { const k = artistKey(t.artist); if (!artistNames.has(k)) artistNames.set(k, { name: t.artist.split(',')[0].trim(), cover: t.coverUrl }); }
  const artists = topFeatures(profile, 'a:', 10).map((k) => artistNames.get(k)).filter((x): x is { name: string; cover?: string } => !!x);

  const albumMap = new Map<string, { source: string; id: string; title: string; artist: string; cover?: string; s: number; n: number }>();
  for (const { t, s } of byScore) {
    const src = t.preferred!;
    if (!src.albumId || !t.album) continue;
    const k = `${src.source}:${src.albumId}`;
    const e = albumMap.get(k) ?? { source: src.source, id: src.albumId, title: t.album, artist: t.artist, cover: t.coverUrl, s: 0, n: 0 };
    e.s += s; e.n++;
    albumMap.set(k, e);
  }
  const albums = [...albumMap.values()].sort((a, b) => b.s / b.n - a.s / a.n).slice(0, 10).map((a) => ({ ...a, reason: a.s > 0 ? 'Близко вашему вкусу' : 'Из подключённых каталогов' }));
  const now = Date.now();
  const fresh = byScore.filter(({ t }) => t.releaseDate && now - Date.parse(t.releaseDate) < 120 * 86_400_000 && !profile.playedTracks.has(t.id)).slice(0, 10).map((x) => x.t);
  let likeRecent: HomeData['likeRecent'] = null;
  if (recent[0]) {
    const sim = similarTo(recent[0], pool, profile, { exclude: new Set(recentIds), limit: 8 });
    if (sim.length) likeRecent = { title: recent[0].title, tracks: sim.map((x) => x.track) };
  }
  const mixes = topFeatures(profile, 't:', 3).map((tag) => ({
    tag, tracks: byScore.filter(({ t }) => t.tags.some((x) => x.toLowerCase() === tag)).slice(0, 12).map((x) => x.t),
  })).filter((m) => m.tracks.length >= 4);
  const topTags = new Set(topFeatures(profile, 't:', 6));
  const genrePopular = pool.filter((t) => t.preferred?.availability === 'full' && !t.preferred.isLive && t.popularity != null && t.tags.some((x) => topTags.has(x.toLowerCase())))
    .sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0)).slice(0, 8);
  return {
    wave, waveTracks: wave.map((w) => tracks.get(w.trackId)).filter((t): t is TrackView => !!t),
    daily: dailyItems.map((d) => tracks.get(d.trackId)).filter((t): t is TrackView => !!t), dailyReasons: new Map(dailyItems.map((d) => [d.trackId, d.reason])),
    recent, artists, albums, fresh, likeRecent, mixes, genrePopular, poolErrors: poolResult.failed, poolSize: pool.length, interactions: profile.interactions,
  };
}

// ---------- Новые релизы любимых исполнителей ----------

export interface ReleaseEntry { artist: string; title: string; date?: string; kind: 'playable' | 'catalog' | 'announced'; trackId?: string; note?: string; album?: { source: string; id: string; coverUrl?: string } }
const RELEASE_WINDOW = 180 * 86_400_000;

export async function newReleases(force = false): Promise<ReleaseEntry[]> {
  const cached = await repo.kvGet<{ at: number; list: ReleaseEntry[] } | null>('releases', null);
  if (!force && cached && Date.now() - cached.at < 12 * 3_600_000) return cached.list;
  const { profile, tracks } = await loadReco();
  const names = new Map<string, string>();
  for (const f of await repo.followedArtists()) names.set(f.key, f.name);
  for (const t of tracks.values()) { const k = artistKey(t.artist); if (profile.playedArtists.has(k) && (profile.weights.get(`a:${k}`) ?? 0) > 0.5 && !names.has(k)) names.set(k, t.artist.split(',')[0].trim()); }
  const artists = [...names.values()].slice(0, 10);
  const sources = await readySources(ctx, (a) => !!a.search && a.capabilities.playback === 'direct-stream' && a.id !== 'radio' && a.id !== 'local');
  const now = Date.now();
  const list: ReleaseEntry[] = [];
  const seen = new Set<string>();
  for (const artist of artists) {
    const results = await Promise.allSettled(sources.map((a) => a.search!(ctx, artist, 15)));
    const found: RemoteTrack[] = results.flatMap((r) => (r.status === 'fulfilled' ? r.value.tracks : []));
    for (const t of found) {
      if (!t.releaseDate || similarity(t.artist, artist) < 0.9 || now - Date.parse(t.releaseDate) > RELEASE_WINDOW || t.availability !== 'full') continue;
      const id = await repo.upsertRemote(t, { pool: true });
      if (seen.has(id)) continue;
      seen.add(id);
      list.push({ artist, title: t.title, date: t.releaseDate, kind: 'playable', trackId: id });
    }
    const dz = adapter('deezer');
    if (dz && (await dz.status(ctx)).state === 'ready') {
      try {
        const hit = (await dz.search!(ctx, artist, 5)).artists.find((a) => similarity(a.name, artist) >= 0.92);
        for (const al of hit ? await dz.artistAlbums!(ctx, hit.id) : []) {
          const released = al.releaseDate;
          if (!released || now - Date.parse(released) > RELEASE_WINDOW || now < Date.parse(released) - 86_400_000 * 60) continue;
          if (list.some((x) => x.artist === artist && similarity(x.title, al.title) > 0.92)) continue;
          list.push({ artist, title: al.title, date: released, kind: 'catalog', album: { source: 'deezer', id: al.id, coverUrl: al.coverUrl }, note: 'Каталог Deezer: фрагменты и ссылки на полную версию' });
        }
      } catch { /* каталог необязателен для этого экрана */ }
    }
    if (settings().musicBrainzEnabled) {
      try {
        const mbid = await musicBrainz.artistId(artist);
        if (mbid) {
          for (const g of await musicBrainz.releaseGroups(mbid)) {
            if (!g.date || g.date.length < 7 || now - Date.parse(g.date.length === 7 ? `${g.date}-01` : g.date) > RELEASE_WINDOW) continue;
            if (list.some((x) => x.artist === artist && similarity(x.title, g.title) > 0.92)) continue;
            list.push({ artist, title: g.title, date: g.date, kind: 'announced', note: 'Найдено в MusicBrainz, в подключённых источниках пока нет' });
          }
        }
      } catch { /* MusicBrainz необязателен для этого экрана */ }
    }
  }
  list.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  await repo.kvSet('releases', { at: Date.now(), list });
  return list;
}

// ---------- Обратная связь ----------

export async function applyFeedback(trackId: string, kind: 'like' | 'dislike' | 'more' | 'less' | 'hide', on = true) {
  await repo.setReaction(trackId, kind, on);
  invalidateReco();
  if (!on) return;
  const rec = await repo.lastRecommendation(trackId);
  if (rec) await repo.updateBandit(rec.bucket as never, kind === 'like' || kind === 'more', 2);
}

export const adapterExternalUrl = (sourceId: string, q: { title: string; artist: string; externalUrl?: string }) => adapter(sourceId)?.externalUrl?.(q) ?? null;
export const linkAdapters = () => ADAPTERS.filter((a) => a.capabilities.supportsDeepLink && a.externalUrl && a.capabilities.playback !== 'direct-stream');
