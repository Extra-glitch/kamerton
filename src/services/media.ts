// Единый поиск, тексты песен, клипы, импорт и воспроизведение: связка источников с базой.

import * as Network from 'expo-network';
import { parseLyrics } from '@/core/lrc';
import { normalizeText, primaryArtist } from '@/core/text';
import type { Lyrics, MusicVideo, RemoteTrack, SourceTrack, TrackView } from '@/core/types';
import * as repo from '@/db/repo';
import { exportPlaylist, parsePlaylist, type ExportFormat, type ImportItem } from '@/import/formats';
import { matchAll, type ImportRow } from '@/import/pipeline';
import { musicBrainz } from '@/meta/musicbrainz';
import { friendlyError, httpJson, query } from '@/net/http';
import { sourceContext as ctx } from '@/platform/secureConfig';
import { ADAPTERS, adapter, isPlayableHere, readySources } from '@/sources/registry';
import type { AlbumRef, ArtistRef, MusicSourceAdapter, PlaylistRef, QualityPreference } from '@/sources/types';
import { findVideo } from '@/sources/youtube';
import { settings } from '@/state/settings';

export interface FederatedResult {
  tracks: TrackView[]; albums: AlbumRef[]; artists: (ArtistRef & { sources: string[] })[]; playlists: PlaylistRef[];
  errors: { source: string; message: string }[]; searched: string[];
}

const searchable = () => readySources(ctx, (a) => !!a.search && a.capabilities.playback !== 'none' && a.capabilities.playback !== 'visible-embed');

export async function federatedSearch(q: string, opts: { sources?: string[]; limit?: number } = {}): Promise<FederatedResult> {
  let list = await searchable();
  if (opts.sources?.length) list = list.filter((a) => opts.sources!.includes(a.id));
  const out: FederatedResult = { tracks: [], albums: [], artists: [], playlists: [], errors: [], searched: list.map((a) => a.name) };
  const results = await Promise.allSettled(list.map((a) => a.search!(ctx, q, opts.limit ?? 20)));
  const ids: string[] = [];
  const artistMap = new Map<string, FederatedResult['artists'][number]>();
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const a = list[i];
    if (r.status === 'rejected') { out.errors.push({ source: a.name, message: friendlyError(r.reason) }); continue; }
    if (a.id !== 'radio') ids.push(...(await repo.upsertMany(r.value.tracks, { mlAllowed: a.capabilities.mlAllowed })));
    else await repo.upsertMany(r.value.tracks);
    out.albums.push(...r.value.albums);
    out.playlists.push(...r.value.playlists);
    for (const ar of r.value.artists) {
      const k = normalizeText(primaryArtist(ar.name));
      const e = artistMap.get(k);
      if (e) e.sources.push(ar.source); else artistMap.set(k, { ...ar, sources: [ar.source] });
    }
  }
  const views = await repo.getViews(ids);
  const n = normalizeText(q);
  const rank = (t: TrackView) => {
    const text = normalizeText(`${t.artist} ${t.title}`);
    const exact = normalizeText(t.title) === n ? 3 : text.includes(n) ? 2 : 0;
    return exact + (t.preferred && isPlayableHere(t.preferred) ? 2 : 0) + Math.min(1, t.sources.length - 1);
  };
  const seen = new Set<string>();
  out.tracks = views.filter((v) => !seen.has(v.id) && !!seen.add(v.id)).map((t, i) => ({ t, i })).sort((a, b) => rank(b.t) - rank(a.t) || a.i - b.i).map((x) => x.t);
  out.artists = [...artistMap.values()];
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
  return repo.getViews(await repo.upsertMany(await a.albumTracks(ctx, id), { pool: true }));
}
export async function artistTracks(source: string, id: string): Promise<TrackView[]> {
  const a = adapter(source);
  if (!a?.artistTracks) return [];
  return repo.getViews(await repo.upsertMany(await a.artistTracks(ctx, id), { pool: true }));
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
  if (s.availability !== 'full') throw new Error('Полная версия недоступна.');
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

export function importTargets(): Promise<MusicSourceAdapter[]> {
  return readySources(ctx, (a) => !!a.search && a.capabilities.playback === 'direct-stream' && a.id !== 'radio');
}

export async function runMatching(name: string, origin: string, items: ImportItem[], onProgress: (d: number, t: number) => void, sourceRows: RemoteTrack[] = []) {
  const targets = await importTargets();
  const searchers = targets.map((a) => async (q: string) => (await a.search!(ctx, q, 8)).tracks);
  // Если строки пришли из API сервиса, сохраняем их как исходные записи с ISRC.
  if (sourceRows.length) await repo.upsertMany(sourceRows, { mlAllowed: adapter(sourceRows[0].source)?.capabilities.mlAllowed });
  const rows = await matchAll(items, { searchers, musicBrainz: settings().musicBrainzEnabled ? musicBrainz : undefined, onProgress });
  draft = { name, origin, rows };
  return draft;
}

export async function linkImport(url: string): Promise<{ title: string; tracks: RemoteTrack[] }> {
  const u = url.trim();
  if (/music\.yandex\.|vk\.(com|ru)\/(music|audio)|boom\.ru/i.test(u)) throw new Error('Яндекс Музыка и VK не дают стороннему приложению читать плейлисты. Скопируйте названия песен и вставьте их как текст.');
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
