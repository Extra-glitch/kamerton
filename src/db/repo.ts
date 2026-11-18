// Единственное место, где приложение обращается к SQLite.

import { chooseSource, type VersionFilter } from '@/core/choose';
import { normalizeText, primaryArtist } from '@/core/text';
import type {
  DiscoveryBucket, Folder, Lyrics, MusicVideo, PlayRecord, Playlist, PlaylistItem, PlaylistItemStatus,
  ReactionKind, RemoteTrack, SourceTrack, Track, TrackView,
} from '@/core/types';
import { canonicalKey, parseTitle, resolveExplicit } from '@/core/versions';
import { migrate } from './schema';
import type { Db, SqlValue } from './types';

let db: Db;
let choice = { directSources: new Set<string>(), priority: [] as string[], versionFilter: 'original_first' as VersionFilter };

export async function initRepo(driver: Db) {
  db = driver;
  await migrate(db);
}
export const rawDb = () => db;

// SQLite не допускает две транзакции одновременно, а источники отвечают параллельно.
let txTail: Promise<unknown> = Promise.resolve();
function tx(fn: () => Promise<void>): Promise<void> {
  const run = txTail.then(() => db.tx(fn));
  txTail = run.catch(() => undefined);
  return run;
}

export function setSourceChoice(next: Partial<typeof choice>) {
  choice = { ...choice, ...next };
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
const parse = <T,>(s: string | null | undefined, fallback: T): T => {
  try { return s ? (JSON.parse(s) as T) : fallback; } catch { return fallback; }
};
const marks = (n: number) => new Array(n).fill('?').join(',');

// ---------- Настройки и служебные значения ----------

export async function kvGet<T>(key: string, fallback: T): Promise<T> {
  const r = await db.get<{ value: string }>('SELECT value FROM kv WHERE key = ?', [key]);
  return r ? parse<T>(r.value, fallback) : fallback;
}
export async function kvSet(key: string, value: unknown) {
  await db.run('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, JSON.stringify(value)]);
}

// ---------- Треки ----------

interface TrackRow {
  id: string; canonical_key: string; title: string; artist: string; album: string | null; duration_sec: number | null;
  isrc: string | null; mbid: string | null; year: number | null; release_date: string | null; tags: string; mood: string | null;
  bpm: number | null; cover_url: string | null; version_tags: string; explicit: string; ml_restricted: number;
  popularity: number | null; preferred_source: string | null; added_at: number;
}
interface SourceRow { id: string; track_id: string; data: string; availability: string; local_path: string | null; fetched_at: number }

function toTrack(r: TrackRow): Track {
  return {
    id: r.id, canonicalKey: r.canonical_key, title: r.title, artist: r.artist, album: r.album ?? undefined,
    durationSec: r.duration_sec ?? undefined, isrc: r.isrc ?? undefined, mbid: r.mbid ?? undefined, year: r.year ?? undefined,
    releaseDate: r.release_date ?? undefined, tags: parse(r.tags, []), mood: r.mood ?? undefined, bpm: r.bpm ?? undefined,
    coverUrl: r.cover_url ?? undefined, versionTags: parse(r.version_tags, []), explicit: r.explicit as Track['explicit'],
    mlRestricted: !!r.ml_restricted, popularity: r.popularity ?? undefined, addedAt: r.added_at,
  };
}

function toSource(r: SourceRow): SourceTrack {
  const data = parse<RemoteTrack>(r.data, {} as RemoteTrack);
  return { ...data, availability: r.availability as RemoteTrack['availability'], id: r.id, trackId: r.track_id, fetchedAt: r.fetched_at, localPath: r.local_path ?? undefined };
}

const CLOSE_DURATION = 6;
const close = (a?: number | null, b?: number | null) => !a || !b || Math.abs(a - b) <= CLOSE_DURATION;

async function findExisting(r: RemoteTrack, key: string): Promise<TrackRow | null> {
  const version = key.split('|')[2];
  const fits = (t: TrackRow) => t.canonical_key.split('|')[2] === version && close(t.duration_sec, r.durationSec);
  if (r.isrc) {
    for (const t of await db.all<TrackRow>('SELECT * FROM tracks WHERE isrc = ?', [r.isrc])) if (fits(t)) return t;
  }
  if (r.mbid) {
    for (const t of await db.all<TrackRow>('SELECT * FROM tracks WHERE mbid = ?', [r.mbid])) if (fits(t)) return t;
  }
  for (const t of await db.all<TrackRow>('SELECT * FROM tracks WHERE canonical_key = ?', [key])) if (close(t.duration_sec, r.durationSec)) return t;
  return null;
}

export interface UpsertOptions { pool?: boolean; library?: boolean; mlAllowed?: boolean; localPath?: string }

/** Сохраняет трек источника и связывает его с общей записью, если это та же композиция. */
export async function upsertRemote(r: RemoteTrack, o: UpsertOptions = {}): Promise<string> {
  const sid = `${r.source}:${r.sourceTrackId}`;
  const now = Date.now();
  const parsed = parseTitle(r.title);
  const explicit = resolveExplicit(r.explicit, parsed.versionTags);
  const key = canonicalKey(r);
  const known = await db.get<{ track_id: string }>('SELECT track_id FROM source_tracks WHERE id = ?', [sid]);
  let row = known ? await db.get<TrackRow>('SELECT * FROM tracks WHERE id = ?', [known.track_id]) : await findExisting(r, key);
  const mlRestricted = o.mlAllowed === false ? 1 : 0;
  // Теги из источников с запретом на ML не попадают в общую запись: она питает рекомендации.
  const tagsIn = o.mlAllowed === false ? [] : (r.tags ?? []).map((t) => t.toLowerCase().trim()).filter(Boolean);

  if (!row) {
    const id = uid();
    await db.run(
      `INSERT INTO tracks (id, canonical_key, title, artist, album, duration_sec, isrc, mbid, year, release_date, tags, mood, bpm, cover_url,
        version_tags, explicit, ml_restricted, popularity, search_text, added_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, key, r.title, r.artist, r.album ?? null, r.durationSec ?? null, r.isrc ?? null, r.mbid ?? null, r.year ?? null, r.releaseDate ?? null,
        JSON.stringify([...new Set(tagsIn)].slice(0, 16)), o.mlAllowed === false ? null : r.mood ?? null, o.mlAllowed === false ? null : r.bpm ?? null,
        r.coverUrl ?? null, JSON.stringify(parsed.versionTags), explicit, mlRestricted, o.mlAllowed === false ? null : r.popularity ?? null,
        normalizeText(`${r.title} ${r.artist} ${r.album ?? ''}`), now],
    );
    row = (await db.get<TrackRow>('SELECT * FROM tracks WHERE id = ?', [id]))!;
  } else {
    const tags = [...new Set([...parse<string[]>(row.tags, []), ...tagsIn])].slice(0, 16);
    const nextExplicit = row.explicit === 'unknown' || (row.explicit === 'not_explicit' && explicit === 'explicit') ? explicit : row.explicit;
    await db.run(
      `UPDATE tracks SET album = COALESCE(album, ?), duration_sec = COALESCE(duration_sec, ?), isrc = COALESCE(isrc, ?), mbid = COALESCE(mbid, ?),
        year = COALESCE(year, ?), release_date = COALESCE(release_date, ?), tags = ?, mood = COALESCE(mood, ?), bpm = COALESCE(bpm, ?),
        cover_url = COALESCE(cover_url, ?), explicit = ?, ml_restricted = MIN(ml_restricted, ?), popularity = COALESCE(?, popularity) WHERE id = ?`,
      [r.album ?? null, r.durationSec ?? null, r.isrc ?? null, r.mbid ?? null, r.year ?? null, r.releaseDate ?? null, JSON.stringify(tags),
        o.mlAllowed === false ? null : r.mood ?? null, o.mlAllowed === false ? null : r.bpm ?? null, r.coverUrl ?? null, nextExplicit, mlRestricted,
        o.mlAllowed === false ? null : r.popularity ?? null, row.id],
    );
  }
  await db.run(
    `INSERT INTO source_tracks (id, track_id, source, availability, data, in_pool, in_library, local_path, fetched_at) VALUES (?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET availability = excluded.availability, data = excluded.data, fetched_at = excluded.fetched_at,
       in_pool = MAX(in_pool, excluded.in_pool), in_library = MAX(in_library, excluded.in_library), local_path = COALESCE(excluded.local_path, local_path)`,
    [sid, row.id, r.source, r.availability, JSON.stringify(r), o.pool ? 1 : 0, o.library ? 1 : 0, o.localPath ?? null, now],
  );
  return row.id;
}

export async function upsertMany(list: RemoteTrack[], o: UpsertOptions = {}): Promise<string[]> {
  const ids: string[] = [];
  await tx(async () => { for (const r of list) ids.push(await upsertRemote(r, o)); });
  return ids;
}

export async function getViews(ids: string[]): Promise<TrackView[]> {
  if (!ids.length) return [];
  const unique = [...new Set(ids)];
  const rows: TrackRow[] = [];
  const sources: SourceRow[] = [];
  const liked = new Set<string>();
  for (let i = 0; i < unique.length; i += 400) {
    const part = unique.slice(i, i + 400);
    const m = marks(part.length);
    rows.push(...(await db.all<TrackRow>(`SELECT * FROM tracks WHERE id IN (${m})`, part)));
    sources.push(...(await db.all<SourceRow>(`SELECT * FROM source_tracks WHERE track_id IN (${m})`, part)));
    for (const r of await db.all<{ track_id: string }>(`SELECT track_id FROM reactions WHERE kind = 'like' AND track_id IN (${m})`, part)) liked.add(r.track_id);
  }
  const bySource = new Map<string, SourceTrack[]>();
  for (const s of sources) {
    const list = bySource.get(s.track_id) ?? [];
    list.push(toSource(s));
    bySource.set(s.track_id, list);
  }
  const views = new Map<string, TrackView>();
  for (const r of rows) {
    const list = bySource.get(r.id) ?? [];
    views.set(r.id, { ...toTrack(r), sources: list, preferred: chooseSource(list, { ...choice, userChoice: r.preferred_source }), liked: liked.has(r.id) });
  }
  return ids.map((id) => views.get(id)).filter((v): v is TrackView => !!v);
}

export const getView = async (id: string) => (await getViews([id]))[0] ?? null;

export const setPreferredSource = (trackId: string, sourceTrackId: string | null) =>
  db.run('UPDATE tracks SET preferred_source = ? WHERE id = ?', [sourceTrackId, trackId]);

export async function updateTrackIdentifiers(trackId: string, v: { isrc?: string; mbid?: string; tags?: string[]; year?: number }) {
  const t = await db.get<TrackRow>('SELECT * FROM tracks WHERE id = ?', [trackId]);
  if (!t) return;
  const tags = [...new Set([...parse<string[]>(t.tags, []), ...(v.tags ?? [])])].slice(0, 16);
  await db.run('UPDATE tracks SET isrc = COALESCE(isrc, ?), mbid = COALESCE(mbid, ?), year = COALESCE(year, ?), tags = ? WHERE id = ?',
    [v.isrc ?? null, v.mbid ?? null, v.year ?? null, JSON.stringify(tags), trackId]);
}

export async function markUnavailable(sourceTrackId: string, availability: RemoteTrack['availability']) {
  await db.run('UPDATE source_tracks SET availability = ? WHERE id = ?', [availability, sourceTrackId]);
}

export type LibrarySort = 'added' | 'title' | 'artist' | 'album' | 'date';
const SORT_SQL: Record<LibrarySort, string> = {
  added: 't.added_at DESC', title: 't.title COLLATE NOCASE', artist: 't.artist COLLATE NOCASE, t.title COLLATE NOCASE',
  album: 't.album COLLATE NOCASE, t.title COLLATE NOCASE', date: 'COALESCE(t.release_date, t.year) DESC',
};

/** Библиотека: лайки, треки из пользовательских плейлистов и локальные файлы. */
export async function libraryTrackIds(o: { search?: string; sort?: LibrarySort; source?: string; limit?: number } = {}): Promise<string[]> {
  const where = [`(t.id IN (SELECT track_id FROM reactions WHERE kind = 'like')
    OR t.id IN (SELECT track_id FROM playlist_items WHERE track_id IS NOT NULL)
    OR t.id IN (SELECT track_id FROM source_tracks WHERE in_library = 1))`];
  const params: SqlValue[] = [];
  if (o.search) { where.push('t.search_text LIKE ?'); params.push(`%${normalizeText(o.search)}%`); }
  if (o.source) { where.push('t.id IN (SELECT track_id FROM source_tracks WHERE source = ?)'); params.push(o.source); }
  const rows = await db.all<{ id: string }>(
    `SELECT t.id FROM tracks t WHERE ${where.join(' AND ')} ORDER BY ${SORT_SQL[o.sort ?? 'added']} LIMIT ?`, [...params, o.limit ?? 5000]);
  return rows.map((r) => r.id);
}

export async function likedTrackIds(): Promise<string[]> {
  return (await db.all<{ track_id: string }>(`SELECT track_id FROM reactions WHERE kind = 'like' ORDER BY at DESC`)).map((r) => r.track_id);
}

export async function localTrackIds(): Promise<string[]> {
  return (await db.all<{ track_id: string }>(`SELECT DISTINCT track_id FROM source_tracks WHERE source = 'local' ORDER BY fetched_at DESC`)).map((r) => r.track_id);
}

export async function libraryArtists(): Promise<{ name: string; count: number }[]> {
  const ids = await libraryTrackIds({ limit: 5000 });
  const views = await getViews(ids);
  const map = new Map<string, { name: string; count: number }>();
  for (const v of views) {
    const name = primaryArtist(v.artist);
    const k = normalizeText(name);
    const e = map.get(k) ?? { name, count: 0 };
    e.count++;
    map.set(k, e);
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

export async function tracksByArtistName(name: string): Promise<string[]> {
  const n = normalizeText(primaryArtist(name));
  const rows = await db.all<{ id: string }>(`SELECT id FROM tracks WHERE canonical_key LIKE ? ORDER BY added_at DESC LIMIT 200`, [`${n}|%`]);
  return rows.map((r) => r.id);
}

// ---------- Реакции и история ----------

export async function setReaction(trackId: string, kind: ReactionKind, on: boolean) {
  await tx(async () => {
    if (on) {
      const opposite: Partial<Record<ReactionKind, ReactionKind[]>> = { like: ['dislike', 'hide'], dislike: ['like', 'more'], more: ['less', 'dislike'], less: ['more'], hide: ['like'] };
      for (const k of opposite[kind] ?? []) await db.run('DELETE FROM reactions WHERE track_id = ? AND kind = ?', [trackId, k]);
      await db.run('INSERT OR REPLACE INTO reactions (track_id, kind, at) VALUES (?,?,?)', [trackId, kind, Date.now()]);
    } else await db.run('DELETE FROM reactions WHERE track_id = ? AND kind = ?', [trackId, kind]);
  });
}

export async function getReactions(): Promise<{ trackId: string; kind: ReactionKind; at: number }[]> {
  const rows = await db.all<{ track_id: string; kind: ReactionKind; at: number }>('SELECT track_id, kind, at FROM reactions');
  return rows.map((r) => ({ trackId: r.track_id, kind: r.kind, at: r.at }));
}

export async function trackReactions(trackId: string): Promise<ReactionKind[]> {
  return (await db.all<{ kind: ReactionKind }>('SELECT kind FROM reactions WHERE track_id = ?', [trackId])).map((r) => r.kind);
}

export async function addPlay(p: PlayRecord): Promise<void> {
  await db.run(`INSERT INTO plays (track_id, source_track_id, started_at, listened_ms, duration_ms, completed, skipped, context) VALUES (?,?,?,?,?,?,?,?)`,
    [p.trackId, p.sourceTrackId, p.startedAt, Math.round(p.listenedMs), Math.round(p.durationMs), p.completed ? 1 : 0, p.skipped ? 1 : 0, p.context]);
}

export async function getPlays(sinceMs = 0): Promise<PlayRecord[]> {
  const rows = await db.all<any>('SELECT * FROM plays WHERE started_at >= ? ORDER BY started_at', [sinceMs]);
  return rows.map((r) => ({ id: r.id, trackId: r.track_id, sourceTrackId: r.source_track_id, startedAt: r.started_at, listenedMs: r.listened_ms, durationMs: r.duration_ms, completed: !!r.completed, skipped: !!r.skipped, context: r.context }));
}

export async function recentPlayedIds(limit = 40): Promise<string[]> {
  return (await db.all<{ track_id: string }>('SELECT track_id, MAX(started_at) AS m FROM plays GROUP BY track_id ORDER BY m DESC LIMIT ?', [limit])).map((r) => r.track_id);
}

export async function historyRows(limit = 300): Promise<{ trackId: string; startedAt: number; completed: boolean; skipped: boolean }[]> {
  const rows = await db.all<any>('SELECT track_id, started_at, completed, skipped FROM plays ORDER BY started_at DESC LIMIT ?', [limit]);
  return rows.map((r) => ({ trackId: r.track_id, startedAt: r.started_at, completed: !!r.completed, skipped: !!r.skipped }));
}

export const clearHistory = () => db.run('DELETE FROM plays');

// ---------- Рекомендации ----------

export async function poolTrackIds(limit = 1500): Promise<string[]> {
  return (await db.all<{ track_id: string }>(
    `SELECT DISTINCT track_id FROM source_tracks WHERE in_pool = 1 AND availability = 'full' ORDER BY fetched_at DESC LIMIT ?`, [limit])).map((r) => r.track_id);
}

export async function getBandit(): Promise<Record<string, { alpha: number; beta: number }>> {
  const out: Record<string, { alpha: number; beta: number }> = {};
  for (const r of await db.all<{ bucket: string; alpha: number; beta: number }>('SELECT * FROM bandit')) out[r.bucket] = { alpha: r.alpha, beta: r.beta };
  return out;
}
export async function updateBandit(bucket: DiscoveryBucket, success: boolean, weight = 1) {
  await db.run(`INSERT INTO bandit (bucket, alpha, beta) VALUES (?, ?, ?)
    ON CONFLICT(bucket) DO UPDATE SET alpha = alpha + ?, beta = beta + ?`,
    [bucket, 1 + (success ? weight : 0), 1 + (success ? 0 : weight), success ? weight : 0, success ? 0 : weight]);
}

export async function logRecommendation(r: { trackId: string; sourceTrackId: string; bucket: string; score: number; reason: string }, context: string) {
  await db.run('INSERT INTO recommendations (track_id, source_track_id, bucket, score, reason, context, at) VALUES (?,?,?,?,?,?,?)',
    [r.trackId, r.sourceTrackId, r.bucket, r.score, r.reason, context, Date.now()]);
}
export async function lastRecommendation(trackId: string) {
  return db.get<{ bucket: string; reason: string; context: string }>('SELECT bucket, reason, context FROM recommendations WHERE track_id = ? ORDER BY at DESC LIMIT 1', [trackId]);
}

export async function getDailyPicks(day: string) {
  return db.all<{ track_id: string; source_track_id: string; bucket: string; reason: string }>('SELECT * FROM daily_picks WHERE day = ? ORDER BY position', [day]);
}
export async function setDailyPicks(day: string, picks: { trackId: string; sourceTrackId: string; bucket: string; reason: string }[]) {
  await tx(async () => {
    await db.run('DELETE FROM daily_picks WHERE day = ?', [day]);
    let i = 0;
    for (const p of picks) await db.run('INSERT INTO daily_picks (day, position, track_id, source_track_id, bucket, reason) VALUES (?,?,?,?,?,?)', [day, i++, p.trackId, p.sourceTrackId, p.bucket, p.reason]);
  });
}

// ---------- Плейлисты ----------

function toPlaylist(r: any): Playlist {
  return { id: r.id, name: r.name, description: r.description ?? undefined, folderId: r.folder_id ?? undefined, coverUri: r.cover_uri ?? undefined,
    imported: !!r.imported, importedFrom: r.imported_from ?? undefined, smartRule: r.smart_rule ?? undefined, createdAt: r.created_at, updatedAt: r.updated_at, itemCount: r.item_count };
}
function toItem(r: any): PlaylistItem {
  return { id: r.id, playlistId: r.playlist_id, position: r.position, originalPosition: r.original_position ?? undefined, trackId: r.track_id ?? undefined,
    status: r.status, rawTitle: r.raw_title, rawArtist: r.raw_artist, rawAlbum: r.raw_album ?? undefined, rawDurationSec: r.raw_duration_sec ?? undefined,
    rawIsrc: r.raw_isrc ?? undefined, matchScore: r.match_score ?? undefined, matchNote: r.match_note ?? undefined, addedAt: r.added_at };
}

export async function listPlaylists(): Promise<Playlist[]> {
  const rows = await db.all<any>(`SELECT p.*, (SELECT COUNT(*) FROM playlist_items i WHERE i.playlist_id = p.id) AS item_count FROM playlists p ORDER BY p.position, p.updated_at DESC`);
  return rows.map(toPlaylist);
}
export async function getPlaylist(id: string): Promise<Playlist | null> {
  const r = await db.get<any>(`SELECT p.*, (SELECT COUNT(*) FROM playlist_items i WHERE i.playlist_id = p.id) AS item_count FROM playlists p WHERE p.id = ?`, [id]);
  return r ? toPlaylist(r) : null;
}
export async function createPlaylist(v: { name: string; description?: string; imported?: boolean; importedFrom?: string; folderId?: string; smartRule?: string }): Promise<string> {
  const id = uid();
  const now = Date.now();
  await db.run('INSERT INTO playlists (id, name, description, folder_id, imported, imported_from, smart_rule, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
    [id, v.name, v.description ?? null, v.folderId ?? null, v.imported ? 1 : 0, v.importedFrom ?? null, v.smartRule ?? null, now, now]);
  return id;
}
export const updatePlaylist = (id: string, v: { name?: string; description?: string | null; folderId?: string | null; coverUri?: string | null }) =>
  db.run(`UPDATE playlists SET name = COALESCE(?, name), description = CASE WHEN ? THEN ? ELSE description END,
    folder_id = CASE WHEN ? THEN ? ELSE folder_id END, cover_uri = CASE WHEN ? THEN ? ELSE cover_uri END, updated_at = ? WHERE id = ?`,
    [v.name ?? null, v.description !== undefined ? 1 : 0, v.description ?? null, v.folderId !== undefined ? 1 : 0, v.folderId ?? null, v.coverUri !== undefined ? 1 : 0, v.coverUri ?? null, Date.now(), id]);
export const deletePlaylist = (id: string) => db.run('DELETE FROM playlists WHERE id = ?', [id]);
export async function movePlaylist(id: string, delta: number) {
  const all = await listPlaylists();
  const i = all.findIndex((p) => p.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= all.length) return;
  [all[i], all[j]] = [all[j], all[i]];
  await tx(async () => { let n = 0; for (const p of all) await db.run('UPDATE playlists SET position = ? WHERE id = ?', [n++, p.id]); });
}

export async function getPlaylistItems(playlistId: string): Promise<PlaylistItem[]> {
  return (await db.all<any>('SELECT * FROM playlist_items WHERE playlist_id = ? ORDER BY position', [playlistId])).map(toItem);
}

export interface NewItem {
  trackId?: string; status: PlaylistItemStatus; rawTitle: string; rawArtist: string; rawAlbum?: string;
  rawDurationSec?: number; rawIsrc?: string; matchScore?: number; matchNote?: string; originalPosition?: number;
}

export async function addPlaylistItems(playlistId: string, items: NewItem[]) {
  const max = await db.get<{ m: number | null }>('SELECT MAX(position) AS m FROM playlist_items WHERE playlist_id = ?', [playlistId]);
  let pos = (max?.m ?? -1) + 1;
  const now = Date.now();
  await tx(async () => {
    for (const it of items) {
      await db.run(`INSERT INTO playlist_items (id, playlist_id, position, original_position, track_id, status, raw_title, raw_artist, raw_album, raw_duration_sec, raw_isrc, match_score, match_note, added_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [uid(), playlistId, pos++, it.originalPosition ?? null, it.trackId ?? null, it.status, it.rawTitle, it.rawArtist, it.rawAlbum ?? null, it.rawDurationSec ?? null, it.rawIsrc ?? null, it.matchScore ?? null, it.matchNote ?? null, now]);
    }
    await db.run('UPDATE playlists SET updated_at = ? WHERE id = ?', [now, playlistId]);
  });
}

export async function addTrackToPlaylist(playlistId: string, trackId: string) {
  const v = await getView(trackId);
  if (v) await addPlaylistItems(playlistId, [{ trackId, status: 'matched', rawTitle: v.title, rawArtist: v.artist, rawAlbum: v.album, rawDurationSec: v.durationSec, rawIsrc: v.isrc }]);
}
export const removePlaylistItem = (id: string) => db.run('DELETE FROM playlist_items WHERE id = ?', [id]);
export const resolvePlaylistItem = (id: string, trackId: string | null, status: PlaylistItemStatus, note?: string) =>
  db.run('UPDATE playlist_items SET track_id = ?, status = ?, match_note = ? WHERE id = ?', [trackId, status, note ?? null, id]);

export async function movePlaylistItem(playlistId: string, itemId: string, delta: number) {
  const items = await getPlaylistItems(playlistId);
  const i = items.findIndex((x) => x.id === itemId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= items.length) return;
  await reorderPlaylist(playlistId, swap(items.map((x) => x.id), i, j));
}
const swap = <T,>(a: T[], i: number, j: number) => { const c = [...a]; [c[i], c[j]] = [c[j], c[i]]; return c; };
export async function reorderPlaylist(playlistId: string, ids: string[]) {
  await tx(async () => { let n = 0; for (const id of ids) await db.run('UPDATE playlist_items SET position = ? WHERE id = ? AND playlist_id = ?', [n++, id, playlistId]); });
}

export async function listFolders(): Promise<Folder[]> { return db.all<Folder>('SELECT id, name, position FROM folders ORDER BY position, name'); }
export async function createFolder(name: string) { const id = uid(); await db.run('INSERT INTO folders (id, name) VALUES (?,?)', [id, name]); return id; }
export const deleteFolder = (id: string) => db.run('DELETE FROM folders WHERE id = ?', [id]);

export async function playlistSignals(): Promise<{ trackId: string; imported: boolean; at: number }[]> {
  const rows = await db.all<any>(`SELECT i.track_id, p.imported, i.added_at FROM playlist_items i JOIN playlists p ON p.id = i.playlist_id WHERE i.track_id IS NOT NULL`);
  return rows.map((r) => ({ trackId: r.track_id, imported: !!r.imported, at: r.added_at }));
}

// ---------- Альбомы и исполнители ----------

export interface SavedAlbum { id: string; title: string; artist: string; coverUrl?: string; source: string; sourceAlbumId: string; at: number }
export async function saveAlbum(a: Omit<SavedAlbum, 'at' | 'id'>) {
  await db.run('INSERT OR REPLACE INTO saved_albums (id, title, artist, cover_url, source, source_album_id, at) VALUES (?,?,?,?,?,?,?)',
    [`${a.source}:${a.sourceAlbumId}`, a.title, a.artist, a.coverUrl ?? null, a.source, a.sourceAlbumId, Date.now()]);
}
export const unsaveAlbum = (id: string) => db.run('DELETE FROM saved_albums WHERE id = ?', [id]);
export async function listSavedAlbums(): Promise<SavedAlbum[]> {
  const rows = await db.all<any>('SELECT * FROM saved_albums ORDER BY at DESC');
  return rows.map((r) => ({ id: r.id, title: r.title, artist: r.artist, coverUrl: r.cover_url ?? undefined, source: r.source, sourceAlbumId: r.source_album_id, at: r.at }));
}
export const followArtist = (name: string, mbid?: string) =>
  db.run('INSERT OR REPLACE INTO followed_artists (key, name, mbid, at) VALUES (?,?,?,?)', [normalizeText(primaryArtist(name)), primaryArtist(name), mbid ?? null, Date.now()]);
export const unfollowArtist = (name: string) => db.run('DELETE FROM followed_artists WHERE key = ?', [normalizeText(primaryArtist(name))]);
export async function followedArtists(): Promise<{ key: string; name: string; mbid?: string }[]> {
  return (await db.all<any>('SELECT * FROM followed_artists ORDER BY at DESC')).map((r) => ({ key: r.key, name: r.name, mbid: r.mbid ?? undefined }));
}

// ---------- Тексты, клипы, загрузки ----------

export async function getCachedLyrics(trackId: string): Promise<{ lyrics: Lyrics | null; at: number } | null> {
  const r = await db.get<{ body: string | null; at: number }>('SELECT body, at FROM lyrics WHERE track_id = ?', [trackId]);
  return r ? { lyrics: parse<Lyrics | null>(r.body, null), at: r.at } : null;
}
export const cacheLyrics = (trackId: string, l: Lyrics | null) =>
  db.run('INSERT OR REPLACE INTO lyrics (track_id, body, origin, at) VALUES (?,?,?,?)', [trackId, l ? JSON.stringify(l) : null, l?.origin ?? null, Date.now()]);

export async function getVideo(trackId: string): Promise<MusicVideo | null> {
  const r = await db.get<any>('SELECT * FROM music_videos WHERE track_id = ?', [trackId]);
  return r ? { provider: r.provider, videoId: r.video_id, title: r.title ?? undefined, origin: r.origin } : null;
}
export const setVideo = (trackId: string, v: MusicVideo) =>
  db.run('INSERT OR REPLACE INTO music_videos (track_id, provider, video_id, title, origin, at) VALUES (?,?,?,?,?,?)', [trackId, v.provider, v.videoId, v.title ?? null, v.origin, Date.now()]);
export const removeVideo = (trackId: string) => db.run('DELETE FROM music_videos WHERE track_id = ?', [trackId]);

export async function getDownload(sourceTrackId: string) { return db.get<{ path: string }>('SELECT path FROM downloads WHERE source_track_id = ?', [sourceTrackId]); }
export const addDownload = (sourceTrackId: string, path: string, bytes: number) => db.run('INSERT OR REPLACE INTO downloads (source_track_id, path, bytes, at) VALUES (?,?,?,?)', [sourceTrackId, path, bytes, Date.now()]);
export const removeDownload = (sourceTrackId: string) => db.run('DELETE FROM downloads WHERE source_track_id = ?', [sourceTrackId]);
export async function downloadedTrackIds(): Promise<string[]> {
  return (await db.all<{ track_id: string }>(`SELECT DISTINCT s.track_id FROM downloads d JOIN source_tracks s ON s.id = d.source_track_id ORDER BY d.at DESC`)).map((r) => r.track_id);
}

// ---------- Друзья и данные пользователя ----------

export async function saveFriend(name: string, card: unknown) { const id = uid(); await db.run('INSERT INTO friends (id, name, card, at) VALUES (?,?,?,?)', [id, name, JSON.stringify(card), Date.now()]); return id; }
export const removeFriend = (id: string) => db.run('DELETE FROM friends WHERE id = ?', [id]);
export async function listFriends<T>(): Promise<{ id: string; name: string; card: T }[]> {
  return (await db.all<any>('SELECT * FROM friends ORDER BY at DESC')).map((r) => ({ id: r.id, name: r.name, card: parse<T>(r.card, {} as T) }));
}

const USER_TABLES = ['reactions', 'plays', 'playlists', 'playlist_items', 'folders', 'saved_albums', 'followed_artists', 'friends', 'bandit', 'daily_picks'];

export async function exportUserData() {
  const out: Record<string, unknown> = { app: 'Камертон', exportedAt: new Date().toISOString() };
  for (const t of USER_TABLES) out[t] = await db.all(`SELECT * FROM ${t}`);
  out.tracks = await db.all(`SELECT id, title, artist, album, isrc, mbid FROM tracks WHERE id IN (SELECT track_id FROM reactions UNION SELECT track_id FROM plays UNION SELECT track_id FROM playlist_items WHERE track_id IS NOT NULL)`);
  return out;
}

export async function deleteAllData() {
  await tx(async () => {
    for (const t of ['daily_picks', 'recommendations', 'bandit', 'friends', 'downloads', 'music_videos', 'lyrics', 'followed_artists', 'saved_albums', 'playlist_items', 'playlists', 'folders', 'plays', 'reactions', 'source_tracks', 'tracks', 'kv']) {
      await db.run(`DELETE FROM ${t}`);
    }
  });
}
