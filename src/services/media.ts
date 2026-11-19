// Единый поиск, тексты песен, клипы, импорт и воспроизведение: связка источников с базой.

import * as Network from 'expo-network';
import { parseLyrics } from '@/core/lrc';
import { isArtistMatch, relevance, RELEVANT } from '@/core/relevance';
import { normalizeText, primaryArtist, similarity } from '@/core/text';
import type { Lyrics, MusicVideo, RemoteTrack, SourceTrack, TrackView } from '@/core/types';
import * as repo from '@/db/repo';
import { exportPlaylist, parsePlaylist, type ExportFormat, type ImportItem } from '@/import/formats';
import { matchAll, type ImportRow } from '@/import/pipeline';
import { musicBrainz } from '@/meta/musicbrainz';
import { friendlyError, httpJson, query } from '@/net/http';
import { sourceContext as ctx } from '@/platform/secureConfig';
import { ADAPTERS, adapter, CATALOG_SOURCES, DIRECT_SOURCES, isPlayableHere, playMode, readySources } from '@/sources/registry';
import type { AlbumRef, ArtistRef, MusicSourceAdapter, PlaylistRef, QualityPreference } from '@/sources/types';
import { deezerArtist } from '@/sources/deezer';
import { findVideo } from '@/sources/youtube';
import { settings } from '@/state/settings';

export interface FederatedResult {
  tracks: TrackView[]; albums: AlbumRef[]; artists: (ArtistRef & { sources: string[] })[]; playlists: PlaylistRef[];
  /** Исполнитель, которого, скорее всего, искали. */
  topArtist: (ArtistRef & { sources: string[] }) | null;
  /** Результаты свободных каталогов, не совпавшие с запросом: показываются только по просьбе. */
  loose: TrackView[];
  errors: { source: string; message: string }[]; searched: string[];
}

const searchable = () => readySources(ctx, (a) => !!a.search && a.capabilities.playback !== 'visible-embed');
const upsertFrom = (a: MusicSourceAdapter | undefined, list: RemoteTrack[], extra: { pool?: boolean; library?: boolean } = {}) =>
  repo.upsertMany(list, { mlAllowed: a?.capabilities.mlAllowed, pool: extra.pool && !!a && DIRECT_SOURCES.has(a.id), library: extra.library });

export const isLink = (q: string) => /^https?:\/\/\S+$/i.test(q.trim());

export async function federatedSearch(q: string, opts: { sources?: string[]; limit?: number } = {}): Promise<FederatedResult> {
  let list = (await searchable()).filter((a) => a.id !== 'itunes');
  if (opts.sources?.length) list = list.filter((a) => opts.sources!.includes(a.id));
  const out: FederatedResult = { tracks: [], albums: [], artists: [], playlists: [], topArtist: null, loose: [], errors: [], searched: list.map((a) => a.name) };
  const results = await Promise.allSettled(list.map((a) => a.search!(ctx, q, opts.limit ?? (CATALOG_SOURCES.has(a.id) ? 40 : 20))));
  const pairs = results.map((r, i) => ({ r, a: list[i] }));
  // Запасной каталог Apple подключается, только если Deezer не ответил или нашёл слишком мало.
  const deezerHit = pairs.find((p) => p.a.id === 'deezer');
  if (!opts.sources?.length && (!deezerHit || deezerHit.r.status === 'rejected' || deezerHit.r.value.tracks.length < 3)) {
    const it = adapter('itunes');
    if (it && (await it.status(ctx)).state === 'ready') {
      out.searched.push(it.name);
      pairs.push({ r: await Promise.allSettled([it.search!(ctx, q, 25)]).then((x) => x[0]), a: it });
    }
  }
  const catalogIds: string[] = [];
  const freeIds: string[] = [];
  const looseIds: string[] = [];
  const artistMap = new Map<string, FederatedResult['artists'][number]>();
  for (const { r, a } of pairs) {
    if (r.status === 'rejected') { out.errors.push({ source: a.name, message: friendlyError(r.reason) }); continue; }
    const catalog = CATALOG_SOURCES.has(a.id);
    const good = catalog ? r.value.tracks : r.value.tracks.filter((t) => relevance(q, t) >= RELEVANT);
    const bad = catalog ? [] : r.value.tracks.filter((t) => relevance(q, t) < RELEVANT);
    (catalog ? catalogIds : freeIds).push(...(await upsertFrom(a, good)));
    looseIds.push(...(await upsertFrom(a, bad)));
    out.albums.push(...r.value.albums.filter((al) => catalog || relevance(q, { title: al.title, artist: al.artist }) >= RELEVANT));
    out.playlists.push(...r.value.playlists);
    for (const ar of r.value.artists) {
      if (!catalog && similarity(q, ar.name) < RELEVANT) continue;
      const k = normalizeText(primaryArtist(ar.name));
      const e = artistMap.get(k);
      if (e) { e.sources.push(ar.source); if (!e.imageUrl && ar.imageUrl) e.imageUrl = ar.imageUrl; }
      else artistMap.set(k, { ...ar, sources: [ar.source] });
    }
  }
  const views = await repo.getViews([...catalogIds, ...freeIds]);
  const order = new Map<string, number>();
  views.forEach((v, i) => { if (!order.has(v.id)) order.set(v.id, i); });
  const score = (t: TrackView) => {
    const r = relevance(q, t);
    const tier = r >= 0.95 ? 2 : r >= RELEVANT ? 1 : 0;
    return tier * 10 + (t.preferred && isPlayableHere(t.preferred) ? 1 : 0);
  };
  out.tracks = [...order.keys()].map((id) => views[order.get(id)!]).sort((a, b) => score(b) - score(a) || order.get(a.id)! - order.get(b.id)!);
  const shown = new Set(out.tracks.map((t) => t.id));
  out.loose = (await repo.getViews(looseIds)).filter((t) => !shown.has(t.id));
  out.artists = [...artistMap.values()].sort((a, b) => similarity(q, b.name) - similarity(q, a.name) || (b.followers ?? 0) - (a.followers ?? 0));
  out.topArtist = out.artists.find((a) => isArtistMatch(q, a.name)) ?? null;
  return out;
}

/** Ссылка на трек, альбом или плейлист: SoundCloud, YouTube, Deezer, Audius, Internet Archive. */
export async function searchLink(url: string): Promise<{ title: string; tracks: TrackView[]; source: string }> {
  const u = url.trim();
  if (/music\.yandex\.|vk\.(com|ru)\/(music|audio)|zvuk\.com/i.test(u)) throw new Error('Яндекс Музыка, VK и Звук не дают сторонним приложениям читать свои страницы. Перенесите список через «Импорт».');
  const a = ADAPTERS.find((x) => x.canHandleLink?.(u) && x.resolveLink);
  if (!a) throw new Error('Такие ссылки пока не поддерживаются. Работают SoundCloud, YouTube, Deezer, Audius и Internet Archive.');
  const st = await a.status(ctx);
  if (st.state !== 'ready' && st.state !== 'link_only') throw new Error(`Сначала подключите ${a.name} в разделе «Источники музыки».`);
  const r = await a.resolveLink!(ctx, u);
  if (!r?.tracks.length) throw new Error('По ссылке ничего не нашлось.');
  return { title: r.title, tracks: await repo.getViews(await upsertFrom(a, r.tracks, { pool: true })), source: a.id };
}

export interface ArtistPage { ref: ArtistRef | null; top: TrackView[]; albums: AlbumRef[]; free: TrackView[]; errors: string[] }

/** Страница исполнителя: популярное и альбомы из каталога, плюс то, что играет целиком. */
export async function artistPage(name: string, deezerId?: string): Promise<ArtistPage> {
  const out: ArtistPage = { ref: null, top: [], albums: [], free: [], errors: [] };
  const dz = adapter('deezer');
  if (dz && (await dz.status(ctx)).state === 'ready') {
    try {
      let id = deezerId;
      if (!id) {
        const r = await dz.search!(ctx, name, 5);
        const hit = r.artists.find((a) => isArtistMatch(name, a.name)) ?? r.artists.find((a) => similarity(primaryArtist(name), a.name) >= 0.92);
        if (hit) { out.ref = hit; id = hit.id; }
      }
      if (id) {
        const [top, albums, info] = await Promise.all([dz.artistTracks!(ctx, id), dz.artistAlbums!(ctx, id).catch(() => []), out.ref ? null : deezerArtist(id).catch(() => null)]);
        if (info) out.ref = info;
        out.top = await repo.getViews(await upsertFrom(dz, top));
        out.albums = albums;
        out.ref ??= { source: 'deezer', id, name, imageUrl: undefined };
      }
    } catch (e) { out.errors.push(`Deezer: ${friendlyError(e)}`); }
  }
  // Полные треки этого исполнителя из свободных источников и с телефона.
  const free = await searchable().then((l) => l.filter((a) => DIRECT_SOURCES.has(a.id) && a.id !== 'radio'));
  const res = await Promise.allSettled(free.map((a) => a.search!(ctx, name, 20).then((r) => ({ a, r }))));
  const ids: string[] = [];
  for (const x of res) {
    if (x.status !== 'fulfilled') continue;
    const mine = x.value.r.tracks.filter((t) => similarity(primaryArtist(t.artist), primaryArtist(name)) >= 0.92);
    ids.push(...(await upsertFrom(x.value.a, mine, { pool: true })));
  }
  const topIds = new Set(out.top.map((t) => t.id));
  out.free = (await repo.getViews(ids)).filter((t) => !topIds.has(t.id) && t.preferred && isPlayableHere(t.preferred));
  return out;
}

export async function radioResults(q: string): Promise<TrackView[]> {
  const a = adapter('radio')!;
  const r = await a.search!(ctx, q, 30);
  return repo.getViews(await repo.upsertMany(r.tracks));
}
export async function storeRadio(list: RemoteTrack[]): Promise<TrackView[]> { return repo.getViews(await repo.upsertMany(list)); }

export async function albumTracks(source: string, id: string): Promise<TrackView[]> {
  const a = adapter(source);
  if (!a?.albumTracks) return [];
  return repo.getViews(await upsertFrom(a, await a.albumTracks(ctx, id), { pool: true }));
}
export async function remotePlaylistTracks(source: string, id: string): Promise<TrackView[]> {
  const a = adapter(source);
  if (!a?.playlistTracks) return [];
  return repo.getViews(await upsertFrom(a, await a.playlistTracks(ctx, id), { pool: true }));
}
export async function artistTracks(source: string, id: string): Promise<TrackView[]> {
  const a = adapter(source);
  if (!a?.artistTracks) return [];
  return repo.getViews(await upsertFrom(a, await a.artistTracks(ctx, id), { pool: true }));
}

async function currentQuality(): Promise<QualityPreference> {
  const s = settings();
  try {
    const st = await Network.getNetworkStateAsync();
    return st.type === Network.NetworkStateType.CELLULAR ? s.qualityCell : s.qualityWifi;
  } catch { return s.qualityCell; }
}

export async function resolveStream(s: SourceTrack) {
  if (s.localPath) return { uri: s.localPath, quality: s.quality };
  const dl = await repo.getDownload(s.id);
  if (dl) return { uri: dl.path, quality: s.quality };
  const a = adapter(s.source);
  if (!a?.resolveStream) throw new Error(`${a?.name ?? s.source} нельзя воспроизвести внутри приложения.`);
  const mode = playMode(s);
  if (mode !== 'player' && mode !== 'preview') throw new Error('Полная версия недоступна.');
  return a.resolveStream(ctx, s, await currentQuality());
}

// ---------- Тексты ----------

export type LyricsResult = { lyrics: Lyrics | null; note?: string };

export async function loadLyrics(track: TrackView, source?: SourceTrack | null): Promise<LyricsResult> {
  const cached = await repo.getCachedLyrics(track.id);
  if (cached?.lyrics) return { lyrics: cached.lyrics };
  if (cached && Date.now() - cached.at < 3 * 86_400_000) return { lyrics: null };
  for (const s of source ? [source, ...track.sources] : track.sources) {
    const a = adapter(s.source);
    if (!a?.lyrics) continue;
    try {
      const l = await a.lyrics(ctx, s);
      if (l) { await repo.cacheLyrics(track.id, l); return { lyrics: l }; }
    } catch { /* пробуем следующий источник */ }
  }
  if (settings().lrclibEnabled) {
    try {
      const r = await httpJson<any>(`https://lrclib.net/api/get?${query({ artist_name: primaryArtist(track.artist), track_name: track.title, album_name: track.album, duration: track.durationSec ? Math.round(track.durationSec) : undefined })}`, { service: 'LRCLIB', retries: 0 });
      const l = parseLyrics(r.syncedLyrics || r.plainLyrics || '', 'LRCLIB, база пользователей');
      if (l) { await repo.cacheLyrics(track.id, l); return { lyrics: l }; }
    } catch { /* текста нет */ }
  }
  await repo.cacheLyrics(track.id, null);
  return { lyrics: null };
}

export async function attachLyricsText(trackId: string, text: string, origin = 'ваш файл') {
  const l = parseLyrics(text, origin);
  if (!l) throw new Error('В файле не найден текст.');
  await repo.cacheLyrics(trackId, l);
  return l;
}

// ---------- Клипы ----------

export async function loadVideo(track: TrackView): Promise<MusicVideo | null> {
  const known = await repo.getVideo(track.id);
  if (known) return known;
  let found: MusicVideo | null = null;
  if (track.mbid && settings().musicBrainzEnabled) {
    try {
      const rec = await musicBrainz.details(track.mbid);
      if (rec.youtubeIds[0]) found = { provider: 'youtube', videoId: rec.youtubeIds[0], origin: 'MusicBrainz' };
    } catch { /* идём дальше */ }
  }
  found ??= await findVideo(ctx, primaryArtist(track.artist), track.title).catch(() => null);
  if (found) await repo.setVideo(track.id, found);
  return found;
}

// ---------- Импорт ----------

export interface ImportDraft { name: string; origin: string; rows: ImportRow[] }
let draft: ImportDraft | null = null;
export const getImportDraft = () => draft;
export const setImportDraft = (d: ImportDraft | null) => { draft = d; };

export const parseImportFile = parsePlaylist;

/** Большой список (сотни песен) сопоставляем быстрее: без MusicBrainz и медленных архивов. */
export const BIG_IMPORT = 120;
const FAST_TARGETS = new Set(['local', 'subsonic', 'deezer', 'audius']);

export function importTargets(size = 0): Promise<MusicSourceAdapter[]> {
  return readySources(ctx, (a) => !!a.search && (a.capabilities.playback === 'direct-stream' || a.id === 'deezer') && a.id !== 'radio' && (size <= BIG_IMPORT || FAST_TARGETS.has(a.id)));
}

export async function runMatching(name: string, origin: string, items: ImportItem[], onProgress: (d: number, t: number) => void, sourceRows: RemoteTrack[] = []) {
  const targets = await importTargets(items.length);
  const searchers = targets.map((a) => async (q: string) => (a.searchTracks ? await a.searchTracks(ctx, q, 8) : (await a.search!(ctx, q, 8)).tracks));
  // Если строки пришли из API сервиса, сохраняем их как исходные записи с ISRC.
  if (sourceRows.length) await repo.upsertMany(sourceRows, { mlAllowed: adapter(sourceRows[0].source)?.capabilities.mlAllowed });
  const big = items.length > BIG_IMPORT;
  const rows = await matchAll(items, { searchers, musicBrainz: settings().musicBrainzEnabled && !big ? musicBrainz : undefined, onProgress, concurrency: big ? 4 : 3 });
  draft = { name, origin, rows };
  return draft;
}

export async function linkImport(url: string): Promise<{ title: string; tracks: RemoteTrack[] }> {
  const u = url.trim();
  if (/music\.yandex\./i.test(u)) throw new Error('Яндекс Музыка не даёт сторонним приложениям читать плейлисты по ссылке. Ниже есть инструкция «Перенести из Яндекс Музыки»: скопируйте список на компьютере или закажите архив данных.');
  if (/vk\.(com|ru)\/(music|audio)|boom\.ru|zvuk\.com/i.test(u)) throw new Error('VK и Звук не дают сторонним приложениям читать плейлисты. Скопируйте названия песен и вставьте их как текст.');
  const a = ADAPTERS.find((x) => x.canHandleLink?.(u) && x.resolveLink);
  if (!a) throw new Error('Для этой ссылки нет разрешённого способа получить список песен. Вставьте названия текстом или загрузите файл.');
  const st = await a.status(ctx);
  if (st.state !== 'ready') throw new Error(`Сначала подключите ${a.name} в разделе «Источники музыки».`);
  const r = await a.resolveLink!(ctx, u);
  if (!r?.tracks.length) throw new Error('По ссылке не нашлось треков.');
  return r;
}

export const remoteToItems = (list: RemoteTrack[]): ImportItem[] => list.map((t, i) => ({ position: i, title: t.title, artist: t.artist, album: t.album, durationSec: t.durationSec, isrc: t.isrc, mbid: t.mbid }));

export async function savePlaylistFromDraft(d: ImportDraft, name: string): Promise<string> {
  const id = await repo.createPlaylist({ name, imported: true, importedFrom: d.origin });
  const items: repo.NewItem[] = [];
  for (const r of d.rows) {
    const base = { rawTitle: r.item.title, rawArtist: r.item.artist, rawAlbum: r.item.album, rawDurationSec: r.item.durationSec, rawIsrc: r.item.isrc, originalPosition: r.item.position, matchScore: r.score, matchNote: r.notes.join('; ') || undefined };
    const accepted = r.best && r.decision !== 'reject' && (r.status === 'matched' || r.decision === 'accept');
    if (accepted) {
      const trackId = await repo.upsertRemote(r.best!, { library: true, mlAllowed: adapter(r.best!.source)?.capabilities.mlAllowed });
      if (r.recording) await repo.updateTrackIdentifiers(trackId, { isrc: r.item.isrc ?? r.recording.isrcs[0], mbid: r.recording.mbid, tags: r.recording.tags.slice(0, 6), year: r.recording.year });
      items.push({ ...base, trackId, status: r.status === 'matched' ? 'matched' : r.status === 'clean_only' ? 'clean_only' : 'doubtful' });
    } else items.push({ ...base, status: 'missing', matchNote: r.notes.join('; ') || 'Не найдено в подключённых источниках' }); // строка не теряется
  }
  await repo.addPlaylistItems(id, items);
  return id;
}

export async function playlistExportText(playlistId: string, fmt: ExportFormat) {
  const p = await repo.getPlaylist(playlistId);
  const items = await repo.getPlaylistItems(playlistId);
  return { name: `${(p?.name ?? 'playlist').replace(/[\\/:*?"<>|]/g, '').trim() || 'playlist'}.${fmt}`, text: exportPlaylist(p?.name ?? 'Плейлист', items.map((i) => ({ title: i.rawTitle, artist: i.rawArtist, album: i.rawAlbum, durationSec: i.rawDurationSec, isrc: i.rawIsrc })), fmt) };
}

export { ctx as sourceCtx };
