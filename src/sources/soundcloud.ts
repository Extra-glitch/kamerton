// SoundCloud: поиск и прослушивание целиком через официальный API, если есть свой ключ.
// Ключ (Client ID и Client Secret) выдаётся владельцам подписки Artist Pro.
// Без ключа работают ссылки: они открываются в официальном встроенном плеере SoundCloud.

import type { Availability, RemoteTrack } from '@/core/types';
import { HttpError, httpJson, query } from '@/net/http';
import { caps, emptySearch, type MusicSourceAdapter, type SourceContext } from './types';

const API = 'https://api.soundcloud.com';
const LINK = /^https?:\/\/(?:www\.|m\.|on\.)?soundcloud\.com\/[^\s]+/i;
const SERVICE = 'SoundCloud';

export const isSoundCloudLink = (url: string) => LINK.test(url.trim());

/** «Название by Автор» из oEmbed превращается в отдельные поля. */
export function mapSoundCloudOembed(url: string, o: any): RemoteTrack {
  const author = String(o.author_name ?? '').trim();
  let title = String(o.title ?? '').trim();
  const suffix = ` by ${author}`;
  if (author && title.endsWith(suffix)) title = title.slice(0, -suffix.length);
  const clean = url.trim().split('?')[0];
  return {
    source: 'soundcloud', sourceTrackId: clean, title: title || 'SoundCloud', artist: author || 'SoundCloud', explicit: 'unknown',
    coverUrl: o.thumbnail_url, availability: 'full', externalUrl: clean, canOffline: false,
    attribution: 'Плеер SoundCloud', extra: { embed: { provider: 'soundcloud', url: clean }, isSet: /\/sets\//.test(clean) },
  };
}

export function soundCloudEmbedUrl(url: string) {
  return `https://w.soundcloud.com/player/?${query({ url, auto_play: 'true', visual: 'true', show_comments: 'false', show_reposts: 'false' })}`;
}

const ACCESS: Record<string, Availability> = { playable: 'full', preview: 'preview', blocked: 'region_blocked' };

/** Трек из API. Поле access прямо говорит, можно ли слушать целиком. */
export function mapSoundCloudTrack(t: any): RemoteTrack {
  const pm = t.publisher_metadata ?? {};
  const date: string | undefined = t.release_date || t.created_at || undefined;
  return {
    source: 'soundcloud', sourceTrackId: String(t.urn ?? t.id), title: String(t.title ?? ''), artist: pm.artist || t.user?.username || 'SoundCloud',
    album: pm.album_title || undefined, durationSec: t.duration ? t.duration / 1000 : t.full_duration ? t.full_duration / 1000 : undefined,
    isrc: pm.isrc || undefined, explicit: pm.explicit === true ? 'explicit' : pm.explicit === false ? 'not_explicit' : 'unknown',
    tags: t.genre ? [String(t.genre)] : [], year: date ? Number(String(date).slice(0, 4)) : undefined,
    coverUrl: (t.artwork_url || t.user?.avatar_url)?.replace('-large.', '-t500x500.'),
    availability: ACCESS[String(t.access ?? 'playable')] ?? 'full', externalUrl: t.permalink_url, canOffline: false,
    quality: { codec: 'MP3', bitrateKbps: 128 }, attribution: 'Звук и данные: SoundCloud', popularity: t.playback_count || undefined,
  };
}

/** Токен приложения хранится на телефоне и обновляется сам. */
async function token(ctx: SourceContext): Promise<string> {
  const c = await ctx.getConfig('soundcloud');
  if (!c.clientId || !c.clientSecret) throw new HttpError('auth', 'SoundCloud: нужен ключ API. Добавьте его в «Источники музыки».');
  if (c.accessToken && Number(c.expiresAt) > Date.now() + 60_000) return c.accessToken;
  const basic = globalThis.btoa(`${c.clientId}:${c.clientSecret}`);
  const body = c.refreshToken ? query({ grant_type: 'refresh_token', refresh_token: c.refreshToken }) : query({ grant_type: 'client_credentials' });
  let r: any;
  try {
    r = await httpJson<any>('https://secure.soundcloud.com/oauth/token', { method: 'POST', body, service: SERVICE, retries: 0, timeoutMs: 9000, headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' } });
  } catch (e) {
    if (!c.refreshToken) throw e;
    // Обновление не удалось: получаем новый токен заново.
    r = await httpJson<any>('https://secure.soundcloud.com/oauth/token', { method: 'POST', body: query({ grant_type: 'client_credentials' }), service: SERVICE, retries: 0, timeoutMs: 9000, headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' } });
  }
  await ctx.setConfig('soundcloud', { accessToken: r.access_token, refreshToken: r.refresh_token ?? '', expiresAt: String(Date.now() + (Number(r.expires_in) || 3600) * 1000) });
  return r.access_token;
}

async function api(ctx: SourceContext, path: string, params: Record<string, string | number | undefined> = {}) {
  const t = await token(ctx);
  const qs = query(params);
  return httpJson<any>(path.startsWith('http') ? path : `${API}${path}${qs ? `?${qs}` : ''}`, { service: SERVICE, retries: 0, timeoutMs: 9000, headers: { Authorization: `OAuth ${t}`, Accept: 'application/json; charset=utf-8' } });
}

const nextPages = new Map<string, string>();

export const soundcloud: MusicSourceAdapter = {
  id: 'soundcloud', name: 'SoundCloud', category: 'independent',
  capabilities: caps({ playback: 'direct-stream', canBackground: true, auth: 'apiKey', supportsSearch: true, supportsDeepLink: true, supportsPlaylistImport: true, attributionRequired: true, mlAllowed: false }),
  configFields: [
    { key: 'clientId', label: 'Client ID', required: true, hint: 'Из раздела приложений SoundCloud for Developers.' },
    { key: 'clientSecret', label: 'Client Secret', secret: true, required: true, hint: 'Хранится только на этом телефоне в защищённом хранилище.' },
  ],
  doc: {
    summary: 'Поиск по SoundCloud и прослушивание целиком прямо в плеере Камертона, в том числе в фоне.',
    limits: [
      'Ключ API SoundCloud выдаёт только владельцам платной подписки Artist Pro.',
      'В России SoundCloud заблокирован: без VPN поиск и звук не загрузятся.',
      'Часть треков SoundCloud отдаёт только фрагментом или не отдаёт в вашем регионе: так и будет подписано.',
      'Без ключа работают только ссылки, они открываются во встроенном плеере SoundCloud.',
    ],
    unconfirmed: ['На настоящем ключе Artist Pro поиск и звук ещё не проверялись.'],
    setup: [
      'Оформите подписку Artist Pro в SoundCloud (нужен VPN).',
      'Откройте developers.soundcloud.com/docs/api/register-app и зарегистрируйте приложение.',
      'Скопируйте Client ID и Client Secret сюда и нажмите «Проверить».',
    ],
    docsUrl: 'https://developers.soundcloud.com/docs/api',
  },
  status: async (ctx) => {
    const c = await ctx.getConfig('soundcloud');
    return c.clientId && c.clientSecret ? { state: 'ready', detail: 'Поиск и прослушивание целиком, в России нужен VPN' } : { state: 'needs_setup', detail: 'Нужен ключ API (подписка Artist Pro). Ссылки работают и без него' };
  },
  verify: async (ctx) => { const r = await api(ctx, '/tracks', { q: 'test', limit: 1 }); return `Ключ принят, поиск отвечает (${(r.collection ?? r ?? []).length ? 'есть результаты' : 'пусто'}).`; },
  canHandleLink: isSoundCloudLink,
  externalUrl: (v) => v.externalUrl ?? `https://soundcloud.com/search?q=${encodeURIComponent(`${v.artist} ${v.title}`)}`,
  async search(ctx, q, limit, page = 0) {
    const out = emptySearch();
    const next = page ? nextPages.get(`${q}|${page}`) : undefined;
    if (page && !next) return out;
    const r = next ? await api(ctx, next) : await api(ctx, '/tracks', { q, limit, access: 'playable,preview,blocked', linked_partitioning: 'true' });
    const list: any[] = Array.isArray(r) ? r : r.collection ?? [];
    out.tracks = list.filter((t) => t.kind === 'track' || t.title).map(mapSoundCloudTrack);
    if (r.next_href) { nextPages.set(`${q}|${page + 1}`, r.next_href); out.hasMore = true; }
    return out;
  },
  async resolveLink(ctx, url) {
    if (!isSoundCloudLink(url)) return null;
    const c = await ctx.getConfig('soundcloud');
    if (c.clientId && c.clientSecret) {
      const r = await api(ctx, '/resolve', { url: url.trim() });
      if (r.kind === 'track') return { title: r.title, tracks: [mapSoundCloudTrack(r)] };
      if (Array.isArray(r.tracks)) return { title: r.title ?? 'SoundCloud', tracks: r.tracks.map(mapSoundCloudTrack) };
    }
    const o = await httpJson<any>(`https://soundcloud.com/oembed?${query({ format: 'json', url: url.trim() })}`, { service: SERVICE, retries: 0 })
      .catch((e: HttpError) => { throw new HttpError(e.kind ?? 'offline', e.kind === 'not_found' ? 'SoundCloud: по ссылке ничего нет или запись закрыта.' : 'SoundCloud недоступен. В России для него нужен VPN.'); });
    const t = mapSoundCloudOembed(url, o);
    return { title: t.title, tracks: [t] };
  },
  async resolveStream(ctx, t) {
    const tok = await token(ctx);
    const s = await api(ctx, `/tracks/${encodeURIComponent(t.sourceTrackId)}/streams`);
    const uri = t.availability === 'full' ? s.http_mp3_128_url ?? s.hls_mp3_128_url ?? s.hls_aac_160_url : s.preview_mp3_128_url;
    if (!uri) throw new HttpError('not_found', 'SoundCloud не отдал звук этого трека.');
    return { uri, headers: { Authorization: `OAuth ${tok}` }, quality: { codec: 'MP3', bitrateKbps: 128 } };
  },
};
