// Каталог Apple (iTunes Search API, российская витрина): только данные о песнях и ссылка на магазин.
// Фрагменты Apple разрешает показывать лишь для продвижения покупок, поэтому они здесь не проигрываются.

import type { ExplicitState, RemoteTrack } from '@/core/types';
import { httpJson, query, RateLimiter } from '@/net/http';
import { caps, emptySearch, type ArtistRef, type MusicSourceAdapter } from './types';

const BASE = 'https://itunes.apple.com';
// Apple указывает лимит около 20 запросов в минуту.
const limiter = new RateLimiter(3000);

const get = (path: string, params: Record<string, string | number>) =>
  httpJson<{ results?: any[] }>(`${BASE}${path}?${query({ country: 'ru', ...params })}`, { service: 'iTunes', limiter, retries: 0 });

export function itunesExplicit(v?: string): ExplicitState {
  if (v === 'explicit') return 'explicit';
  if (v === 'cleaned') return 'clean';
  if (v === 'notExplicit') return 'not_explicit';
  return 'unknown';
}

const big = (url?: string) => url?.replace(/\/\d+x\d+bb\./, '/600x600bb.');

export function mapItunesTrack(t: any): RemoteTrack {
  return {
    source: 'itunes', sourceTrackId: String(t.trackId), title: t.trackName, artist: t.artistName, artistId: t.artistId ? String(t.artistId) : undefined,
    album: t.collectionName, albumId: t.collectionId ? String(t.collectionId) : undefined, trackNumber: t.trackNumber,
    durationSec: t.trackTimeMillis ? t.trackTimeMillis / 1000 : undefined, explicit: itunesExplicit(t.trackExplicitness),
    tags: t.primaryGenreName ? [String(t.primaryGenreName)] : [], year: t.releaseDate ? Number(String(t.releaseDate).slice(0, 4)) : undefined,
    releaseDate: t.releaseDate ? String(t.releaseDate).slice(0, 10) : undefined, coverUrl: big(t.artworkUrl100),
    availability: 'external_only', attribution: 'Данные: Apple', externalUrl: t.trackViewUrl, canOffline: false,
  };
}

export const itunes: MusicSourceAdapter = {
  id: 'itunes', name: 'Apple (каталог)', category: 'commercial',
  capabilities: caps({ playback: 'none', supportsSearch: true, supportsDeepLink: true, attributionRequired: true, mlAllowed: false, metadata: { explicit: true, genres: true } }),
  doc: {
    summary: 'Запасной каталог для поиска российских исполнителей: названия, альбомы, обложки, пометка Explicit и ссылка на страницу в Apple.',
    limits: ['Ничего не проигрывает: фрагменты Apple разрешены только для продвижения покупок.', 'Около 20 запросов в минуту, поэтому подключается, только если Deezer не ответил или нашёл мало.'],
    unconfirmed: ['Доступность из России без VPN не проверена.'],
    setup: ['Ничего настраивать не нужно.'],
    docsUrl: 'https://performance-partners.apple.com/search-api',
  },
  status: async () => ({ state: 'ready', detail: 'Запасной каталог для поиска' }),
  externalUrl: (v) => v.externalUrl ?? null,
  async search(_ctx, q, limit) {
    const out = emptySearch();
    const r = await get('/search', { term: q, entity: 'song', limit });
    out.tracks = (r.results ?? []).filter((x) => x.kind === 'song').map(mapItunesTrack);
    const seen = new Map<string, ArtistRef>();
    for (const t of r.results ?? []) if (t.artistId && !seen.has(String(t.artistId))) seen.set(String(t.artistId), { source: 'itunes', id: String(t.artistId), name: t.artistName });
    out.artists = [...seen.values()].slice(0, 4);
    return out;
  },
};
