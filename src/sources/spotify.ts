// Spotify: вход PKCE и импорт собственных плейлистов и лайков.
// Звук Spotify нельзя получить в наш плеер, данные Spotify нельзя использовать в рекомендательной модели.

import type { RemoteTrack } from '@/core/types';
import { HttpError, httpJson, query } from '@/net/http';
import { spotifyAccessToken } from '@/platform/oauth';
import { spotifyPlayback } from './external';
import { caps, type MusicSourceAdapter, type PlaylistRef, type SourceContext } from './types';

const API = 'https://api.spotify.com/v1';
const SERVICE = 'Spotify';

async function get(ctx: SourceContext, url: string) {
  const token = await spotifyAccessToken(ctx);
  if (!token) throw new HttpError('auth', 'Войдите в Spotify в разделе «Источники музыки».');
  return httpJson<any>(url.startsWith('http') ? url : `${API}${url}`, { service: SERVICE, headers: { Authorization: `Bearer ${token}` } });
}

export function mapSpotifyTrack(t: any): RemoteTrack | null {
  if (!t?.id || t.type === 'episode') return null;
  return {
    source: 'spotify', sourceTrackId: t.id, title: t.name, artist: (t.artists ?? []).map((a: any) => a.name).join(', '), artists: (t.artists ?? []).map((a: any) => a.name),
    album: t.album?.name, albumId: t.album?.id, durationSec: t.duration_ms ? t.duration_ms / 1000 : undefined, isrc: t.external_ids?.isrc,
    explicit: t.explicit === true ? 'explicit' : t.explicit === false ? 'unknown' : 'unknown',
    year: t.album?.release_date ? Number(String(t.album.release_date).slice(0, 4)) : undefined, releaseDate: t.album?.release_date,
    coverUrl: t.album?.images?.[0]?.url, availability: 'external_only', externalUrl: t.external_urls?.spotify ?? `https://open.spotify.com/track/${t.id}`,
  };
}

async function collect(ctx: SourceContext, first: string, pick: (it: any) => any, max = 2000) {
  const out: RemoteTrack[] = [];
  let url: string | null = first;
  while (url && out.length < max) {
    const page: any = await get(ctx, url);
    for (const it of page.items ?? []) { const t = mapSpotifyTrack(pick(it)); if (t) out.push(t); }
    url = page.next ?? null;
  }
  return out;
}

export const spotify: MusicSourceAdapter = {
  id: 'spotify', name: 'Spotify', category: 'commercial',
  capabilities: caps({ playback: 'external-app', auth: 'oauthPkce', requiresUserSubscription: true, requiresOfficialApp: true, supportsSearch: true, supportsLibraryImport: true, supportsPlaylistImport: true, supportsDeepLink: true, mlAllowed: false, attributionRequired: true, metadata: { isrc: true, explicit: true } }),
  configFields: [{ key: 'clientId', label: 'Client ID', required: true, hint: 'Из панели developer.spotify.com. Секрет не нужен и не вводится.' }],
  doc: {
    summary: 'Импорт ваших плейлистов и лайков с ISRC. Песни открываются в официальном приложении Spotify.',
    limits: [spotifyPlayback, 'Владельцу приложения нужен Premium, доступ не более чем у 5 пользователей.', 'Импортируются только ваши и совместные плейлисты.', 'Spotify не работает в России с 2022 года, обход ограничений приложение не выполняет.', 'Данные Spotify не используются в рекомендациях и не смешиваются со звуком других сервисов.'],
    unconfirmed: ['На реальном аккаунте импорт ещё не проверялся.', 'Правила режима разработки часто меняются.'],
    setup: ['Откройте developer.spotify.com/dashboard и создайте приложение.', 'Добавьте Redirect URI: kamerton://spotify-auth', 'Скопируйте Client ID сюда и нажмите «Войти».'],
    docsUrl: 'https://developer.spotify.com/documentation/web-api',
  },
  status: async (ctx) => {
    const c = await ctx.getConfig('spotify');
    if (!c.clientId) return { state: 'needs_setup', detail: 'Нужен свой Client ID' };
    if (!c.refreshToken) return { state: 'needs_setup', detail: 'Нужно войти в аккаунт' };
    return { state: 'ready', detail: 'Импорт и переход в приложение Spotify' };
  },
  verify: async (ctx) => { const me = await get(ctx, '/me'); return `Вход выполнен: ${me.display_name ?? me.id}.`; },
  async search(ctx, q, limit, page = 0) {
    const r = await get(ctx, `/search?${query({ q, type: 'track,artist', limit: Math.min(limit, 50), offset: page * Math.min(limit, 50) })}`);
    return {
      tracks: (r.tracks?.items ?? []).map(mapSpotifyTrack).filter((t: RemoteTrack | null): t is RemoteTrack => !!t),
      artists: (r.artists?.items ?? []).slice(0, 4).map((a: any) => ({ source: 'spotify', id: a.id, name: a.name, imageUrl: a.images?.[0]?.url, followers: a.followers?.total })),
      albums: [], playlists: [], hasMore: !!r.tracks?.next,
    };
  },
  canHandleLink: (url) => /open\.spotify\.com\/playlist\//i.test(url),
  externalUrl: (v) => v.externalUrl ?? `https://open.spotify.com/search/${encodeURIComponent(`${v.artist} ${v.title}`)}`,

  async userPlaylists(ctx) {
    const out: PlaylistRef[] = [];
    let url: string | null = `/me/playlists?${query({ limit: 50 })}`;
    while (url) {
      const page: any = await get(ctx, url);
      for (const p of page.items ?? []) if (p) out.push({ source: 'spotify', id: p.id, title: p.name, owner: p.owner?.display_name, coverUrl: p.images?.[0]?.url, trackCount: p.items?.total ?? p.tracks?.total });
      url = page.next ?? null;
    }
    return out;
  },
  playlistTracks: (ctx, id) => collect(ctx, `/playlists/${id}/items?${query({ limit: 50 })}`, (it) => it.item ?? it.track),
  likedTracks: (ctx) => collect(ctx, `/me/tracks?${query({ limit: 50 })}`, (it) => it.track),
  async resolveLink(ctx, url) {
    const id = url.match(/playlist\/([A-Za-z0-9]+)/)?.[1];
    if (!id) return null;
    const meta = await get(ctx, `/playlists/${id}?${query({ fields: 'name' })}`);
    return { title: meta.name, tracks: await spotify.playlistTracks!(ctx, id) };
  },
};
