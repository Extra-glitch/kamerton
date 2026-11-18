import { parseLyrics } from '@/core/lrc';
import type { RemoteTrack } from '@/core/types';
import { HttpError, httpJson, query } from '@/net/http';
import { caps, DIRECT, emptySearch, type AlbumRef, type ArtistRef, type MusicSourceAdapter, type QualityPreference, type SourceContext } from './types';

const BASE = 'https://api.jamendo.com/v3.0';
const SERVICE = 'Jamendo';

async function clientId(ctx: SourceContext) {
  const id = (await ctx.getConfig('jamendo')).clientId;
  if (!id) throw new HttpError('auth', 'Jamendo: укажите client_id в разделе «Источники музыки».');
  return id;
}

async function get(ctx: SourceContext, path: string, params: Record<string, string | number | undefined>) {
  const r = await httpJson<{ headers: { status: string; code: number; error_message?: string }; results: any[] }>(
    `${BASE}${path}?${query({ client_id: await clientId(ctx), format: 'json', ...params })}`, { service: SERVICE });
  if (r.headers?.status && r.headers.status !== 'success') {
    throw new HttpError(r.headers.code === 5 ? 'auth' : 'server', `Jamendo: ${r.headers.error_message || 'ошибка запроса'}`);
  }
  return r.results ?? [];
}

const LICENSE_NAMES: [RegExp, string][] = [[/by-nc-nd/, 'CC BY-NC-ND'], [/by-nc-sa/, 'CC BY-NC-SA'], [/by-nc/, 'CC BY-NC'], [/by-nd/, 'CC BY-ND'], [/by-sa/, 'CC BY-SA'], [/\/by\//, 'CC BY']];

export function licenseName(url?: string): string | undefined {
  return url ? LICENSE_NAMES.find(([re]) => re.test(url))?.[1] : undefined;
}

export function mapJamendoTrack(t: any): RemoteTrack {
  const info = t.musicinfo ?? {};
  const tags: string[] = [...(info.tags?.genres ?? []), ...(info.tags?.vartags ?? []), ...(info.tags?.instruments ?? [])];
  const license = licenseName(t.license_ccurl);
  return {
    source: 'jamendo', sourceTrackId: String(t.id), title: t.name, artist: t.artist_name, artistId: t.artist_id ? String(t.artist_id) : undefined,
    album: t.album_name || undefined, albumId: t.album_id ? String(t.album_id) : undefined, trackNumber: t.position ? Number(t.position) : undefined,
    durationSec: t.duration ?? undefined, explicit: 'unknown', tags, mood: info.tags?.vartags?.[0],
    year: t.releasedate ? Number(String(t.releasedate).slice(0, 4)) : undefined, releaseDate: t.releasedate || undefined,
    coverUrl: t.album_image || t.image || undefined, availability: t.audio ? 'full' : 'gone', quality: { codec: 'MP3' },
    licenseUrl: t.license_ccurl || undefined, attribution: `${t.artist_name} на Jamendo${license ? `, ${license}` : ''}`,
    externalUrl: t.shareurl || t.shorturl || undefined, canOffline: false,
    extra: { streamUrl: t.audio },
  };
}

const FIELDS = { include: 'musicinfo', imagesize: 500, audioformat: 'mp32' };

export const jamendo: MusicSourceAdapter = {
  id: 'jamendo', name: 'Jamendo', category: 'open',
  capabilities: caps({ ...DIRECT, auth: 'apiKey', supportsSearch: true, supportsDiscovery: true, supportsDeepLink: true, attributionRequired: true, metadata: { genres: true, license: true } }),
  configFields: [{ key: 'clientId', label: 'Client ID', required: true, placeholder: 'например, 1a2b3c4d', hint: 'Бесплатно на devportal.jamendo.com' }],
  doc: {
    summary: 'Каталог независимой музыки под лицензиями Creative Commons, полные треки в приложении.',
    limits: ['Только некоммерческое использование. Если приложение станет платным, нужен договор с Jamendo.', '35 000 запросов в месяц на ключ.', 'Лицензия показывается у каждого трека. Офлайн выключен.', 'Сервис не сообщает, есть ли в треке цензура.'],
    unconfirmed: ['Условия о кэшировании известны из вторичных источников.', 'Точный битрейт режима mp32 документация не называет.', 'Доступность из России нужно проверить на телефоне.'],
    setup: ['Откройте devportal.jamendo.com и зарегистрируйтесь.', 'Примите условия API и создайте приложение.', 'Скопируйте Client ID и вставьте его сюда.'],
    docsUrl: 'https://developer.jamendo.com/v3.0',
  },
  status: async (ctx) => ((await ctx.getConfig('jamendo')).clientId ? { state: 'ready' } : { state: 'needs_setup', detail: 'Нужен бесплатный Client ID' }),
  verify: async (ctx) => { await get(ctx, '/tracks', { limit: 1 }); return 'Ключ принят, каталог доступен.'; },
  externalUrl: (q) => q.externalUrl ?? `https://www.jamendo.com/search?q=${encodeURIComponent(`${q.artist} ${q.title}`)}`,

  async search(ctx, q, limit) {
    const out = emptySearch();
    const [tracks, albums, artists] = await Promise.allSettled([
      get(ctx, '/tracks', { search: q, limit, boost: 'popularity_total', ...FIELDS }),
      get(ctx, '/albums', { namesearch: q, limit: 6, imagesize: 500 }),
      get(ctx, '/artists', { namesearch: q, limit: 5 }),
    ]);
    if (tracks.status === 'rejected') throw tracks.reason;
    out.tracks = tracks.value.map(mapJamendoTrack);
    if (albums.status === 'fulfilled') out.albums = albums.value.map((a): AlbumRef => ({ source: 'jamendo', id: String(a.id), title: a.name, artist: a.artist_name, coverUrl: a.image, year: a.releasedate ? Number(String(a.releasedate).slice(0, 4)) : undefined }));
    if (artists.status === 'fulfilled') out.artists = artists.value.map((a): ArtistRef => ({ source: 'jamendo', id: String(a.id), name: a.name, imageUrl: a.image || undefined }));
    return out;
  },

  async discover(ctx, req) {
    const order = req.mode === 'fresh' ? 'releasedate_desc' : req.mode === 'rare' ? 'buzzrate_desc' : 'popularity_month';
    const jobs = [
      get(ctx, '/tracks', { fuzzytags: req.tags.slice(0, 6).join(' ') || undefined, limit: Math.min(req.limit, 200), order, ...FIELDS }),
      ...req.artists.slice(0, 3).map((a) => get(ctx, '/tracks', { artist_name: a, limit: 10, ...FIELDS })),
    ];
    const results = await Promise.allSettled(jobs);
    if (results[0].status === 'rejected') throw results[0].reason;
    return results.flatMap((r) => (r.status === 'fulfilled' ? r.value.map(mapJamendoTrack) : []));
  },

  async albumTracks(ctx, id) { return (await get(ctx, '/tracks', { album_id: id, limit: 100, order: 'id', ...FIELDS })).map(mapJamendoTrack); },
  async artistTracks(ctx, id) { return (await get(ctx, '/tracks', { artist_id: id, limit: 100, order: 'releasedate_desc', ...FIELDS })).map(mapJamendoTrack); },

  async lyrics(ctx, t) {
    const [r] = await get(ctx, '/tracks', { id: t.sourceTrackId, include: 'lyrics' });
    const text = r?.lyrics ?? r?.musicinfo?.lyrics;
    return typeof text === 'string' && text.trim() ? parseLyrics(text, 'Jamendo') : null;
  },

  async resolveStream(ctx, t, q: QualityPreference) {
    // Ссылки потока содержат формат: берём лёгкий вариант для экономии трафика.
    const url = new URLSearchParamsLite(String(t.extra?.streamUrl ?? ''));
    if (!url.base) throw new HttpError('not_found', 'Jamendo не вернул ссылку на этот трек.');
    const format = q === 'data_saver' ? 'mp31' : 'mp32';
    url.set('format', format);
    return { uri: url.toString(), quality: format === 'mp31' ? { codec: 'MP3', bitrateKbps: 96 } : { codec: 'MP3' } };
  },
};

/** Минимальная работа с query-строкой: URLSearchParams в Hermes реализован не полностью. */
class URLSearchParamsLite {
  base: string;
  private pairs: [string, string][] = [];
  constructor(url: string) {
    const [base, qs] = url.split('?');
    this.base = base;
    for (const p of (qs ?? '').split('&').filter(Boolean)) {
      const i = p.indexOf('=');
      this.pairs.push(i < 0 ? [p, ''] : [p.slice(0, i), p.slice(i + 1)]);
    }
  }
  set(k: string, v: string) {
    const hit = this.pairs.find(([x]) => x === k);
    if (hit) hit[1] = v; else this.pairs.push([k, v]);
  }
  toString() { return this.pairs.length ? `${this.base}?${this.pairs.map(([k, v]) => `${k}=${v}`).join('&')}` : this.base; }
}
