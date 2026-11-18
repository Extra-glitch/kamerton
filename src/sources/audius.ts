import type { Availability, ExplicitState, RemoteTrack } from '@/core/types';
import { httpJson, query } from '@/net/http';
import { caps, DIRECT, emptySearch, type AlbumRef, type ArtistRef, type MusicSourceAdapter, type PlaylistRef, type SourceContext } from './types';

const BASE = 'https://api.audius.co/v1';
const APP = 'kamerton';
const SERVICE = 'Audius';

async function auth(ctx: SourceContext) {
  const c = await ctx.getConfig('audius');
  return c.apiKey ? { api_key: c.apiKey } : { app_name: APP };
}

async function get(ctx: SourceContext, path: string, params: Record<string, string | number | undefined> = {}) {
  const url = `${BASE}${path}?${query({ ...(await auth(ctx)), ...params })}`;
  return httpJson<{ data: any }>(url, { service: SERVICE });
}

function explicitOf(raw?: string | null): ExplicitState {
  const v = (raw ?? '').toLowerCase().replace(/[^a-z]/g, '');
  if (!v) return 'unknown';
  if (v === 'notexplicit') return 'not_explicit';
  if (v.includes('edited') || v === 'clean') return 'clean';
  if (v === 'explicit') return 'explicit';
  return 'unknown';
}

function availabilityOf(t: any): Availability {
  if (t.is_delete || t.is_available === false || t.user?.is_deactivated) return 'gone';
  if (t.is_streamable === false) return 'gone';
  if (t.is_stream_gated && t.access?.stream === false) return t.preview_cid || t.preview ? 'preview' : 'subscription_required';
  return 'full';
}

export function mapAudiusTrack(t: any): RemoteTrack {
  const tags = String(t.tags ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (t.genre) tags.unshift(String(t.genre));
  const remixed = (t.remix_of?.tracks?.length ?? 0) > 0;
  let title = String(t.title ?? '').trim();
  // Источник прямо сообщает о ремиксе или кавере: отражаем это в названии версии.
  if (remixed && !/remix|ремикс/i.test(title)) title = `${title} (Remix)`;
  if (t.cover_original_song_title && !/cover|кавер/i.test(title)) title = `${title} (Cover)`;
  return {
    source: 'audius', sourceTrackId: String(t.id), title,
    artist: t.user?.name ?? t.user?.handle ?? 'Неизвестный исполнитель', artistId: t.user?.id,
    durationSec: t.duration ?? undefined, isrc: t.isrc || undefined, explicit: explicitOf(t.parental_warning_type),
    tags, mood: t.mood || undefined, bpm: t.bpm ? Math.round(t.bpm) : undefined,
    year: t.release_date ? new Date(t.release_date).getUTCFullYear() : undefined, releaseDate: t.release_date ?? undefined,
    coverUrl: t.artwork?.['480x480'] ?? t.artwork?.['150x150'], availability: availabilityOf(t),
    quality: { codec: 'MP3' }, licenseUrl: t.license || undefined, externalUrl: t.permalink ? `https://audius.co${t.permalink}` : undefined,
    popularity: t.play_count ?? undefined, canOffline: false,
  };
}

export const audius: MusicSourceAdapter = {
  id: 'audius', name: 'Audius', category: 'independent',
  capabilities: caps({ ...DIRECT, canOffline: false, auth: 'apiKey', supportsSearch: true, supportsDiscovery: true, supportsPlaylistImport: true, supportsDeepLink: true, metadata: { isrc: true, explicit: true, genres: true, audioFeatures: true, license: true } }),
  configFields: [{ key: 'apiKey', label: 'API-ключ', hint: 'Необязательно. Публичные запросы работают и без него.', secret: true }],
  doc: {
    summary: 'Независимая платформа: полные треки играют прямо в приложении.',
    limits: ['Часть треков закрыта условиями автора, они помечаются и не попадают в волну.', 'Качество потока сервис не сообщает, показываем только формат MP3.', 'Сохранение для офлайна не включено.'],
    unconfirmed: ['Поля ISRC и parental_warning_type есть в ответе API, но авторы заполняют их редко.', 'Доступность из России нужно проверить на телефоне.'],
    setup: ['Ничего вводить не нужно. Ключ можно создать на api.audius.co/plans и указать здесь.'],
    docsUrl: 'https://docs.audius.co',
  },
  status: async () => ({ state: 'ready' }),
  verify: async (ctx) => {
    const r = await get(ctx, '/tracks/trending', { limit: 1 });
    return r.data?.length ? 'Audius отвечает, треки доступны.' : 'Audius ответил, но список пуст.';
  },
  canHandleLink: (url) => /(^|\/\/)(www\.)?audius\.co\//i.test(url),
  externalUrl: (q) => q.externalUrl ?? `https://audius.co/search/${encodeURIComponent(`${q.artist} ${q.title}`)}`,

  async search(ctx, q, limit) {
    const out = emptySearch();
    const [tracks, users, lists] = await Promise.allSettled([
      get(ctx, '/tracks/search', { query: q, limit }),
      get(ctx, '/users/search', { query: q, limit: 5 }),
      get(ctx, '/playlists/search', { query: q, limit: 5 }),
    ]);
    if (tracks.status === 'rejected') throw tracks.reason;
    out.tracks = (tracks.value.data ?? []).map(mapAudiusTrack);
    if (users.status === 'fulfilled') out.artists = (users.value.data ?? []).map((u: any): ArtistRef => ({ source: 'audius', id: u.id, name: u.name, imageUrl: u.profile_picture?.['480x480'], followers: u.follower_count }));
    if (lists.status === 'fulfilled') {
      for (const p of lists.value.data ?? []) {
        if (p.is_album) out.albums.push({ source: 'audius', id: p.id, title: p.playlist_name, artist: p.user?.name ?? '', coverUrl: p.artwork?.['480x480'], trackCount: p.track_count } satisfies AlbumRef);
        else out.playlists.push({ source: 'audius', id: p.id, title: p.playlist_name, owner: p.user?.name, coverUrl: p.artwork?.['480x480'], trackCount: p.track_count } satisfies PlaylistRef);
      }
    }
    return out;
  },

  async discover(ctx, req) {
    const per = Math.max(5, Math.ceil(req.limit / Math.max(1, req.tags.length + req.artists.length)));
    const jobs: Promise<{ data: any }>[] = [];
    for (const tag of req.tags.slice(0, 5)) jobs.push(get(ctx, '/tracks/search', { query: tag, limit: per }));
    for (const a of req.artists.slice(0, 3)) jobs.push(get(ctx, '/tracks/search', { query: a, limit: per }));
    if (req.mode === 'rare') jobs.push(get(ctx, '/tracks/trending/underground', { limit: per }));
    if (!jobs.length || req.mode === 'popular') jobs.push(get(ctx, '/tracks/trending', { limit: req.limit, time: 'month' }));
    const results = await Promise.allSettled(jobs);
    if (results.every((r) => r.status === 'rejected')) throw (results[0] as PromiseRejectedResult).reason;
    return results.flatMap((r) => (r.status === 'fulfilled' ? (r.value.data ?? []).map(mapAudiusTrack) : []));
  },

  async artistTracks(ctx, id) { return ((await get(ctx, `/users/${id}/tracks`, { limit: 50, sort: 'date' })).data ?? []).map(mapAudiusTrack); },
  async albumTracks(ctx, id) { return ((await get(ctx, `/playlists/${id}/tracks`)).data ?? []).map(mapAudiusTrack); },
  async playlistTracks(ctx, id) { return ((await get(ctx, `/playlists/${id}/tracks`)).data ?? []).map(mapAudiusTrack); },

  async resolveLink(ctx, url) {
    const r = await get(ctx, '/resolve', { url });
    const d = Array.isArray(r.data) ? r.data[0] : r.data;
    if (!d) return null;
    if (d.playlist_name) return { title: d.playlist_name, tracks: ((await get(ctx, `/playlists/${d.id}/tracks`)).data ?? []).map(mapAudiusTrack) };
    if (d.title) return { title: d.title, tracks: [mapAudiusTrack(d)] };
    return null;
  },

  async resolveStream(ctx, t) {
    return { uri: `${BASE}/tracks/${t.sourceTrackId}/stream?${query(await auth(ctx))}`, quality: { codec: 'MP3' } };
  },
};
