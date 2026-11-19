// Каталог Deezer: поиск, обложки и 30-секундные фрагменты через публичный API без ключа.
// Полные треки Deezer сторонним приложениям не отдаёт, поэтому всё помечается как фрагмент.

import type { Availability, ExplicitState, RemoteTrack } from '@/core/types';
import { HttpError, httpJson, query, RateLimiter } from '@/net/http';
import { caps, emptySearch, type AlbumRef, type ArtistRef, type MusicSourceAdapter } from './types';

const BASE = 'https://api.deezer.com';
const SERVICE = 'Deezer';
// Публичный API допускает около 50 запросов за 5 секунд.
const limiter = new RateLimiter(120);

async function get<T = any>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  const qs = query(params);
  const r = await httpJson<any>(`${BASE}${path}${qs ? `?${qs}` : ''}`, { service: SERVICE, limiter });
  if (r?.error) {
    if (r.error.code === 4) throw new HttpError('rate_limit', 'Deezer: слишком много запросов, повторите чуть позже.');
    if (r.error.code === 800) return { data: [] } as T;
    throw new HttpError('server', `Deezer: ${r.error.message ?? 'ошибка запроса'}`);
  }
  return r as T;
}

/** Коды explicit_content_lyrics из документации Deezer. */
export function deezerExplicit(t: { explicit_lyrics?: boolean; explicit_content_lyrics?: number }): ExplicitState {
  switch (t.explicit_content_lyrics) {
    case 1: case 4: return 'explicit';
    case 3: return 'clean';
    case 0: return 'not_explicit';
  }
  return t.explicit_lyrics === true ? 'explicit' : 'unknown';
}

export function mapDeezerTrack(t: any, album?: { title?: string; cover?: string; id?: number | string; release_date?: string }): RemoteTrack {
  const availability: Availability = t.readable === false ? 'region_blocked' : t.preview ? 'preview' : 'external_only';
  const releaseDate: string | undefined = t.release_date || album?.release_date || undefined;
  return {
    source: 'deezer', sourceTrackId: String(t.id), title: String(t.title ?? ''), artist: t.artist?.name ?? 'Неизвестный исполнитель',
    artists: t.contributors?.map((c: any) => c.name), artistId: t.artist?.id ? String(t.artist.id) : undefined,
    album: t.album?.title ?? album?.title, albumId: t.album?.id ? String(t.album.id) : album?.id ? String(album.id) : undefined,
    trackNumber: t.track_position, durationSec: t.duration || undefined, isrc: t.isrc || undefined, explicit: deezerExplicit(t),
    bpm: t.bpm || undefined, year: releaseDate ? Number(releaseDate.slice(0, 4)) : undefined, releaseDate,
    coverUrl: t.album?.cover_big ?? t.album?.cover_medium ?? album?.cover, availability,
    quality: { codec: 'MP3', bitrateKbps: 128 }, attribution: 'Фрагмент 30 с и данные: Deezer', externalUrl: t.link,
    popularity: t.rank || undefined, canOffline: false, extra: { preview: t.preview },
  };
}

const albumRef = (a: any): AlbumRef => ({ source: 'deezer', id: String(a.id), title: a.title, artist: a.artist?.name ?? '', coverUrl: a.cover_big ?? a.cover_medium, year: a.release_date ? Number(String(a.release_date).slice(0, 4)) : undefined, releaseDate: a.release_date || undefined, trackCount: a.nb_tracks, kind: a.record_type });
const artistRef = (a: any): ArtistRef => ({ source: 'deezer', id: String(a.id), name: a.name, imageUrl: a.picture_big ?? a.picture_medium, followers: a.nb_fan });

/** Карточка исполнителя: фото и число поклонников. */
export async function deezerArtist(id: string): Promise<ArtistRef> { return artistRef(await get<any>(`/artist/${id}`)); }

export const deezer: MusicSourceAdapter = {
  id: 'deezer', name: 'Deezer', category: 'commercial',
  capabilities: caps({ playback: 'preview-only', canBackground: true, auth: 'none', supportsSearch: true, supportsDeepLink: true, supportsPlaylistImport: true, attributionRequired: true, mlAllowed: false, metadata: { isrc: true, explicit: true } }),
  doc: {
    summary: 'Большой каталог для поиска, включая российских исполнителей: обложки, альбомы и 30-секундные фрагменты.',
    limits: [
      'Только фрагменты по 30 секунд: полные треки Deezer сторонним приложениям не отдаёт.',
      'Фрагменты не сохраняются и не попадают в волну и историю прослушиваний.',
      'Полностью песню можно открыть в Яндекс Музыке, VK или Звуке кнопкой в меню трека.',
      'Разрешено некоммерческое использование с указанием Deezer.',
    ],
    unconfirmed: ['Работа API из России без VPN не проверена: проверка шла из сети GitHub.', 'Условия Deezer об использовании метаданных в рекомендациях не проверены. Используется только имя исполнителя и год.'],
    setup: ['Ничего настраивать не нужно.'],
    docsUrl: 'https://developers.deezer.com/api',
  },
  status: async () => ({ state: 'ready', detail: 'Поиск и фрагменты по 30 секунд' }),
  verify: async () => { const r = await get<any>('/search', { q: 'Кино', limit: 1 }); return r.data?.length ? 'Каталог Deezer отвечает.' : 'Deezer ответил, но ничего не нашёл.'; },
  canHandleLink: (url) => /deezer\.com\/(?:[a-z]{2}\/)?(album|playlist)\/\d+/i.test(url),
  externalUrl: (v) => v.externalUrl ?? `https://www.deezer.com/search/${encodeURIComponent(`${v.artist} ${v.title}`)}`,

  async search(_ctx, q, limit) {
    const out = emptySearch();
    const [tracks, artists, albums] = await Promise.allSettled([
      get<any>('/search', { q, limit }), get<any>('/search/artist', { q, limit: 6 }), get<any>('/search/album', { q, limit: 8 }),
    ]);
    if (tracks.status === 'rejected') throw tracks.reason;
    out.tracks = (tracks.value.data ?? []).map((t: any) => mapDeezerTrack(t));
    if (artists.status === 'fulfilled') out.artists = (artists.value.data ?? []).map(artistRef);
    if (albums.status === 'fulfilled') out.albums = (albums.value.data ?? []).map(albumRef);
    return out;
  },
  async searchTracks(_ctx, q, limit) { return ((await get<any>('/search', { q, limit })).data ?? []).map((t: any) => mapDeezerTrack(t)); },
  async artistTracks(_ctx, id) {
    const [top, albums] = await Promise.all([get<any>(`/artist/${id}/top`, { limit: 50 }), get<any>(`/artist/${id}/albums`, { limit: 50 }).catch(() => ({ data: [] }))]);
    const dates = new Map<string, string>((albums.data ?? []).map((a: any) => [String(a.id), String(a.release_date ?? "")] as [string, string]));
    return (top.data ?? []).map((t: any) => mapDeezerTrack(t, { release_date: dates.get(String(t.album?.id)) }));
  },
  async artistAlbums(_ctx, id) { return ((await get<any>(`/artist/${id}/albums`, { limit: 50 })).data ?? []).map(albumRef); },
  async albumTracks(_ctx, id) {
    const a = await get<any>(`/album/${id}`);
    return (a.tracks?.data ?? []).map((t: any, i: number) => mapDeezerTrack({ ...t, track_position: t.track_position ?? i + 1 }, { title: a.title, cover: a.cover_big, id: a.id, release_date: a.release_date }));
  },
  async playlistTracks(_ctx, id) { return ((await get<any>(`/playlist/${id}/tracks`, { limit: 1000 })).data ?? []).map((t: any) => mapDeezerTrack(t)); },
  async resolveLink(ctx, url) {
    const m = url.match(/(album|playlist)\/(\d+)/i);
    if (!m) return null;
    const meta = await get<any>(`/${m[1].toLowerCase()}/${m[2]}`);
    const tracks = m[1].toLowerCase() === 'album' ? await deezer.albumTracks!(ctx, m[2]) : await deezer.playlistTracks!(ctx, m[2]);
    return { title: meta.title ?? 'Deezer', tracks };
  },
  async resolveStream(_ctx, t) {
    const uri = String(t.extra?.preview ?? '');
    if (!uri) throw new HttpError('not_found', 'У этого трека нет фрагмента.');
    return { uri, quality: { codec: 'MP3', bitrateKbps: 128 } };
  },
};
