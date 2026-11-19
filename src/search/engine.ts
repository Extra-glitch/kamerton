// Единый поиск по всем источникам сразу (Multi-Source Search).
//
// Каждый источник опрашивается параллельно и независимо: медленный или упавший сервис
// не задерживает остальные. Результаты появляются по мере ответов, одинаковые песни
// из разных сервисов объединяются в одну запись (src/db/repo.ts, canonicalKey).
// Для каждого источника хранится понятное состояние: это видно на экране диагностики.

import { create } from 'zustand';
import { isArtistMatch, relevance, RELEVANT } from '@/core/relevance';
import { normalizeText, primaryArtist, similarity } from '@/core/text';
import type { RemoteTrack, TrackView } from '@/core/types';
import * as repo from '@/db/repo';
import { musicBrainz } from '@/meta/musicbrainz';
import { friendlyError, HttpError } from '@/net/http';
import { sourceContext as ctx } from '@/platform/secureConfig';
import { adapter, DIRECT_SOURCES, isPlayableHere } from '@/sources/registry';
import type { AlbumRef, ArtistRef, MusicSourceAdapter, SearchOutcome } from '@/sources/types';
import { settings } from '@/state/settings';
import { queryVariants } from './variants';

export type SearchGroup = 'songs' | 'archive' | 'radio';
export type ProviderState = 'pending' | 'ok' | 'empty' | 'error' | 'timeout' | 'needs_setup';

/** Какие источники участвуют в обычном поиске песен и как с ними обращаться. */
interface ProviderSpec {
  id: string;
  group: SearchGroup;
  /** Каталог отвечает за точность сам. Ответы свободных площадок проверяются на совпадение с запросом. */
  trusted: boolean;
  /** Сколько вариантов написания запроса отправлять. У YouTube дорогая квота: только исходный. */
  variants: 'all' | 'original';
  pageSize: number;
}

export const PROVIDERS: ProviderSpec[] = [
  { id: 'deezer', group: 'songs', trusted: true, variants: 'all', pageSize: 40 },
  { id: 'youtube', group: 'songs', trusted: false, variants: 'original', pageSize: 20 },
  { id: 'soundcloud', group: 'songs', trusted: false, variants: 'all', pageSize: 25 },
  { id: 'itunes', group: 'songs', trusted: true, variants: 'all', pageSize: 25 },
  { id: 'spotify', group: 'songs', trusted: true, variants: 'original', pageSize: 20 },
  { id: 'local', group: 'songs', trusted: false, variants: 'all', pageSize: 50 },
  { id: 'subsonic', group: 'songs', trusted: false, variants: 'all', pageSize: 30 },
  { id: 'audius', group: 'songs', trusted: false, variants: 'all', pageSize: 20 },
  { id: 'jamendo', group: 'songs', trusted: false, variants: 'all', pageSize: 20 },
  { id: 'archive', group: 'archive', trusted: false, variants: 'all', pageSize: 20 },
  { id: 'radio', group: 'radio', trusted: false, variants: 'all', pageSize: 30 },
];

let TIMEOUT_MS = 10_000;
/** Для тестов: сколько ждать один источник. */
export function setSearchTimeout(ms: number) { TIMEOUT_MS = ms; }

/** Ответы с жёсткой квотой запоминаются: YouTube даёт около 100 поисков в сутки, Apple около 20 в минуту. */
const CACHE_TTL: Record<string, number> = { youtube: 24 * 3_600_000, itunes: 6 * 3_600_000 };

export async function cachedSearch(a: MusicSourceAdapter, q: string, limit: number, page = 0): Promise<SearchOutcome> {
  const ttl = CACHE_TTL[a.id];
  if (!ttl) return a.search!(ctx, q, limit, page);
  const key = `search:${a.id}:${normalizeText(q)}:${limit}:${page}`;
  const hit = await repo.kvGet<{ at: number; r: SearchOutcome } | null>(key, null);
  if (hit && Date.now() - hit.at < ttl) return hit.r;
  const r = await a.search!(ctx, q, limit, page);
  await repo.kvSet(key, { at: Date.now(), r });
  return r;
}

export interface ProviderRun {
  id: string; name: string; state: ProviderState;
  /** Сколько треков источник вернул всего и сколько из них совпали с запросом. */
  received: number; matched: number;
  ms?: number; error?: string; hint?: string; page: number; hasMore: boolean; ids: string[];
}

export interface SearchSnapshot {
  q: string; group: SearchGroup; variants: string[]; startedAt: number; done: boolean;
  runs: ProviderRun[]; tracks: TrackView[]; loose: TrackView[];
  artists: (ArtistRef & { sources: string[] })[]; albums: AlbumRef[]; topArtist: (ArtistRef & { sources: string[] }) | null;
}

const empty = (q = '', group: SearchGroup = 'songs'): SearchSnapshot => ({ q, group, variants: [], startedAt: 0, done: true, runs: [], tracks: [], loose: [], artists: [], albums: [], topArtist: null });

export const useSearch = create<SearchSnapshot>(() => empty());

/** Последние поиски для экрана диагностики. */
export const useSearchLog = create<{ items: SearchSnapshot[] }>(() => ({ items: [] }));

function withTimeout<T>(p: Promise<T>, ms: number, name: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new HttpError('timeout', `${name} не ответил за ${ms >= 1000 ? Math.round(ms / 1000) : (ms / 1000).toFixed(1)} с.`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

interface Session {
  token: number; q: string; group: SearchGroup; variants: string[];
  runs: Map<string, ProviderRun>;
  good: Map<string, number>; // id трека → лучшая оценка
  loose: Set<string>;
  order: Map<string, number>;
  artists: Map<string, ArtistRef & { sources: string[] }>;
  albums: AlbumRef[];
  seen: Map<string, Set<string>>;
}

let current: Session | null = null;
let tokenSeq = 0;

const specOf = (id: string) => PROVIDERS.find((p) => p.id === id)!;
const bestRelevance = (variants: string[], t: { title: string; artist: string; album?: string }) => Math.max(0, ...variants.map((v) => relevance(v, t)));

async function publish(s: Session, done = false) {
  if (current?.token !== s.token) return;
  const goodIds = [...s.good.keys()];
  const views = await repo.getViews(goodIds);
  if (current?.token !== s.token) return;
  const score = (t: TrackView) => {
    const r = bestRelevance(s.variants, t);
    const tier = r >= 0.95 ? 3 : r >= RELEVANT ? 2 : r >= 0.7 ? 1 : 0;
    const playable = t.preferred && isPlayableHere(t.preferred) ? 1 : 0;
    return tier * 10 + playable * 2 + Math.min(2, new Set(t.sources.map((x) => x.source)).size - 1);
  };
  const seen = new Set<string>();
  const tracks = views.filter((v) => !v.preferred?.isLive || s.group === 'radio').filter((v) => !seen.has(v.id) && !!seen.add(v.id))
    .sort((a, b) => score(b) - score(a) || (s.order.get(a.id) ?? 0) - (s.order.get(b.id) ?? 0));
  const looseViews = (await repo.getViews([...s.loose].filter((id) => !s.good.has(id))));
  const artists = [...s.artists.values()].sort((a, b) => Math.max(...s.variants.map((v) => similarity(v, b.name))) - Math.max(...s.variants.map((v) => similarity(v, a.name))) || (b.followers ?? 0) - (a.followers ?? 0));
  const topArtist = artists.find((a) => s.variants.some((v) => isArtistMatch(v, a.name))) ?? null;
  const snap: SearchSnapshot = {
    q: s.q, group: s.group, variants: s.variants, startedAt: useSearch.getState().startedAt, done,
    runs: [...s.runs.values()], tracks, loose: looseViews, artists, albums: s.albums, topArtist,
  };
  useSearch.setState(snap);
  if (done) useSearchLog.setState((l) => ({ items: [snap, ...l.items.filter((x) => x.q !== snap.q || x.group !== snap.group)].slice(0, 10) }));
}

async function absorb(s: Session, a: MusicSourceAdapter, spec: ProviderSpec, list: RemoteTrack[], artists: ArtistRef[], albums: AlbumRef[]) {
  const run = s.runs.get(a.id)!;
  // Варианты написания часто находят одно и то же: считаем каждую запись один раз.
  const seen = s.seen.get(a.id) ?? new Set<string>();
  s.seen.set(a.id, seen);
  list = list.filter((t) => !seen.has(t.sourceTrackId) && !!seen.add(t.sourceTrackId));
  run.received += list.length;
  const keep: RemoteTrack[] = [];
  const drop: RemoteTrack[] = [];
  for (const t of list) (spec.trusted || bestRelevance(s.variants, t) >= RELEVANT ? keep : drop).push(t);
  const opts = { mlAllowed: a.capabilities.mlAllowed, pool: DIRECT_SOURCES.has(a.id) && spec.group === 'songs' };
  const ids = await repo.upsertMany(keep, opts);
  const looseIds = await repo.upsertMany(drop, { mlAllowed: a.capabilities.mlAllowed });
  ids.forEach((id, i) => {
    const r = bestRelevance(s.variants, keep[i]);
    s.good.set(id, Math.max(s.good.get(id) ?? 0, r));
    if (!s.order.has(id)) s.order.set(id, s.order.size);
  });
  looseIds.forEach((id) => s.loose.add(id));
  run.ids.push(...ids);
  run.matched += ids.length;
  for (const ar of artists) {
    if (!spec.trusted && !s.variants.some((v) => similarity(v, ar.name) >= RELEVANT)) continue;
    const k = normalizeText(primaryArtist(ar.name));
    const e = s.artists.get(k);
    // Карточка каталога точнее: у неё фото, число слушателей и страница с популярным.
    if (e && spec.trusted && !specOf(e.source)?.trusted) s.artists.set(k, { ...ar, imageUrl: ar.imageUrl ?? e.imageUrl, sources: [ar.source, ...e.sources] });
    else if (e) { if (!e.sources.includes(ar.source)) e.sources.push(ar.source); if (!e.imageUrl && ar.imageUrl) e.imageUrl = ar.imageUrl; }
    else s.artists.set(k, { ...ar, sources: [ar.source] });
  }
  for (const al of albums) if ((spec.trusted || bestRelevance(s.variants, { title: al.title, artist: al.artist }) >= RELEVANT) && !s.albums.some((x) => x.source === al.source && x.id === al.id)) s.albums.push(al);
}

async function runProvider(s: Session, a: MusicSourceAdapter, spec: ProviderSpec, variants: string[], page: number) {
  const run = s.runs.get(a.id)!;
  const started = Date.now();
  run.state = 'pending';
  const results = await Promise.allSettled(variants.map((v) => withTimeout(cachedSearch(a, v, spec.pageSize, page), TIMEOUT_MS, a.name)));
  if (current?.token !== s.token) return;
  let ok = false;
  let more = false;
  const errors: unknown[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') { ok = true; more ||= !!r.value.hasMore; await absorb(s, a, spec, r.value.tracks, page ? [] : r.value.artists, page ? [] : r.value.albums); }
    else errors.push(r.reason);
  }
  run.ms = (run.ms ?? 0) + (Date.now() - started);
  run.page = page;
  run.hasMore = more;
  if (ok) { run.state = run.received ? 'ok' : 'empty'; run.error = errors.length ? friendlyError(errors[0]) : undefined; }
  else {
    const e = errors[0] as HttpError;
    run.state = e?.kind === 'timeout' ? 'timeout' : e?.kind === 'auth' ? 'needs_setup' : 'error';
    run.error = friendlyError(e);
  }
  console.log(`Поиск «${s.q}» ${a.id}: ${run.state}, получено ${run.received}, подходит ${run.matched}, ${run.ms} мс${run.error ? `, ${run.error}` : ''}`);
}

/** Запускает поиск. Предыдущий поиск при этом забывается: его ответы больше не показываются. */
export async function runSearch(q: string, group: SearchGroup = 'songs'): Promise<void> {
  const query = q.trim();
  const s: Session = { token: ++tokenSeq, q: query, group, variants: queryVariants(query), runs: new Map(), good: new Map(), loose: new Set(), order: new Map(), artists: new Map(), albums: [], seen: new Map() };
  current = s;
  useSearch.setState({ ...empty(query, group), startedAt: Date.now(), done: false, variants: s.variants });
  if (!query) return;
  const specs = PROVIDERS.filter((p) => p.group === group);
  const adapters = specs.map((p) => adapter(p.id)).filter((a): a is MusicSourceAdapter => !!a?.search);
  const statuses = await Promise.all(adapters.map((a) => a.status(ctx).catch(() => ({ state: 'needs_setup' as const, detail: 'Не удалось проверить подключение' }))));
  if (current?.token !== s.token) return;
  const ready: MusicSourceAdapter[] = [];
  adapters.forEach((a, i) => {
    const st = statuses[i];
    const isReady = st.state === 'ready';
    s.runs.set(a.id, { id: a.id, name: a.name, state: isReady ? 'pending' : 'needs_setup', received: 0, matched: 0, hint: isReady ? undefined : st.detail, page: 0, hasMore: false, ids: [] });
    if (isReady) ready.push(a);
  });
  await publish(s);
  const jobs = ready.map((a) => {
    const spec = specOf(a.id);
    return runProvider(s, a, spec, spec.variants === 'all' ? s.variants : s.variants.slice(0, 1), 0).then(() => publish(s));
  });
  // Другие написания имени исполнителя из MusicBrainz: ищем ими в каталогах дополнительно.
  if (group === 'songs' && settings().musicBrainzEnabled && query.split(/\s+/).length <= 4) {
    jobs.push((async () => {
      const names = await withTimeout(musicBrainz.artistNames(query), 7000, 'MusicBrainz').catch(() => [] as string[]);
      const extra = names.filter((n) => !s.variants.some((v) => normalizeText(v) === normalizeText(n)));
      if (!extra.length || current?.token !== s.token) return;
      s.variants.push(...extra);
      const catalogs = ready.filter((a) => specOf(a.id).trusted || a.id === 'soundcloud');
      await Promise.all(catalogs.map((a) => runProvider(s, a, specOf(a.id), extra, 0).then(() => publish(s))));
    })());
  }
  await Promise.allSettled(jobs);
  await publish(s, true);
}

/** Следующая страница: у одного источника или у всех, где она есть. */
export async function loadMore(providerId?: string): Promise<void> {
  const s = current;
  if (!s) return;
  const targets = [...s.runs.values()].filter((r) => r.hasMore && (!providerId || r.id === providerId));
  if (!targets.length) return;
  useSearch.setState({ done: false });
  await Promise.allSettled(targets.map((r) => {
    const a = adapter(r.id)!;
    const spec = specOf(r.id);
    return runProvider(s, a, spec, spec.variants === 'all' ? s.variants.slice(0, 2) : s.variants.slice(0, 1), r.page + 1).then(() => publish(s));
  }));
  await publish(s, true);
}

export const STATE_TEXT: Record<ProviderState, string> = {
  pending: 'ищет…', ok: 'ответил', empty: 'ничего не нашёл', error: 'ошибка', timeout: 'не ответил вовремя', needs_setup: 'нужно подключить',
};
