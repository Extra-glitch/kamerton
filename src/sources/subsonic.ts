import { parseLyrics } from '@/core/lrc';
import { md5 } from '@/core/md5';
import type { ExplicitState, Lyrics, RemoteTrack } from '@/core/types';
import { HttpError, httpJson, query } from '@/net/http';
import { caps, DIRECT, emptySearch, type MusicSourceAdapter, type QualityPreference, type SourceContext } from './types';

const SERVICE = 'Медиасервер';
const CLIENT = 'Kamerton';

function salt() { return Math.random().toString(36).slice(2, 12).padEnd(10, 'x'); }

export function authParams(c: Record<string, string>): Record<string, string> {
  const common = { v: '1.16.1', c: CLIENT, f: 'json' };
  if (c.apiKey) return { ...common, apiKey: c.apiKey };
  const s = salt();
  return { ...common, u: c.username, t: md5(`${c.password}${s}`), s };
}

async function config(ctx: SourceContext) {
  const c = await ctx.getConfig('subsonic');
  if (!c.url || (!c.apiKey && !(c.username && c.password))) throw new HttpError('auth', 'Укажите адрес медиасервера и данные для входа.');
  return { ...c, url: c.url.trim().replace(/\/+$/, '') };
}

function endpoint(c: Record<string, string>, method: string, params: Record<string, string | number | undefined> = {}) {
  return `${c.url}/rest/${method}?${query({ ...authParams(c), ...params })}`;
}

async function call(ctx: SourceContext, method: string, params: Record<string, string | number | undefined> = {}) {
  const c = await config(ctx);
  const r = await httpJson<any>(endpoint(c, method, params), { service: SERVICE });
  const body = r['subsonic-response'];
  if (!body) throw new HttpError('bad_response', 'Сервер ответил не по протоколу Subsonic.');
  if (body.status !== 'ok') {
    const code = body.error?.code;
    throw new HttpError(code === 40 || code === 41 || code === 44 ? 'auth' : 'server', `Медиасервер: ${body.error?.message ?? 'ошибка запроса'}`);
  }
  return body;
}

function explicitOf(v?: string): ExplicitState {
  if (v === 'explicit') return 'explicit';
  if (v === 'clean') return 'clean';
  return 'unknown';
}

// В базе хранится только ссылка-метка: адрес с токеном собирается при показе и никуда не записывается.
const COVER_PREFIX = 'subsonic-cover:';
const coverRef = (id?: string) => (id ? `${COVER_PREFIX}${id}` : undefined);
let display: { url: string; auth: Record<string, string> } | null = null;

export function setSubsonicDisplayConfig(c: Record<string, string>) {
  display = c.url && (c.apiKey || (c.username && c.password)) ? { url: c.url.trim().replace(/\/+$/, ''), auth: authParams(c) } : null;
}

export function displayCover(uri?: string): string | undefined {
  if (!uri?.startsWith(COVER_PREFIX)) return uri;
  if (!display) return undefined;
  return `${display.url}/rest/getCoverArt?${query({ ...display.auth, id: uri.slice(COVER_PREFIX.length), size: 600 })}`;
}
const LOSSLESS = new Set(['flac', 'alac', 'wav', 'aiff', 'ape', 'wv', 'dsf']);

export function mapChild(s: any, _c?: Record<string, string>): RemoteTrack {
  const suffix = String(s.suffix ?? '').toLowerCase();
  const tags = [...(s.genres ?? []).map((g: any) => g.name), ...(s.genre ? [s.genre] : [])];
  return {
    source: 'subsonic', sourceTrackId: String(s.id), title: s.title, artist: s.displayArtist || s.artist || 'Неизвестный исполнитель',
    artists: s.artists?.map((a: any) => a.name), artistId: s.artistId, album: s.album, albumId: s.albumId, trackNumber: s.track,
    durationSec: s.duration, isrc: s.isrc?.[0], mbid: s.musicBrainzId || undefined, explicit: explicitOf(s.explicitStatus), tags,
    mood: s.moods?.[0], bpm: s.bpm || undefined, year: s.year, coverUrl: coverRef(s.coverArt), availability: 'full',
    quality: { codec: suffix.toUpperCase() || undefined, bitrateKbps: s.bitRate, sampleRateHz: s.samplingRate, bitDepth: s.bitDepth, lossless: LOSSLESS.has(suffix) },
    popularity: s.playCount, canOffline: true,
  };
}

const songs = (v: any): any[] => (Array.isArray(v) ? v : v ? [v] : []);

export const subsonic: MusicSourceAdapter = {
  id: 'subsonic', name: 'Свой медиасервер', category: 'server',
  capabilities: caps({ ...DIRECT, canOffline: true, auth: 'server', supportsSearch: true, supportsDiscovery: true, supportsLibraryImport: true, supportsPlaylistImport: true, metadata: { isrc: true, explicit: true, genres: true, audioFeatures: true } }),
  configFields: [
    { key: 'url', label: 'Адрес сервера', required: true, placeholder: 'https://music.example.ru', hint: 'Navidrome, Airsonic, Gonic и другие серверы Subsonic' },
    { key: 'apiKey', label: 'API-ключ', secret: true, hint: 'Предпочтительно, если сервер поддерживает OpenSubsonic API keys' },
    { key: 'username', label: 'Логин' },
    { key: 'password', label: 'Пароль', secret: true },
  ],
  doc: {
    summary: 'Ваша собственная коллекция на своём сервере: полные треки, FLAC, плейлисты и офлайн.',
    limits: ['Нужен запущенный сервер, например Navidrome.', 'При обычном http логин защищён слабо: для доступа через интернет используйте https.'],
    unconfirmed: ['ISRC, метка цензуры и тексты появляются, только если их отдаёт ваш сервер.', 'На реальном Navidrome интеграция ещё не проверялась.'],
    setup: ['Укажите адрес сервера.', 'Введите API-ключ либо логин и пароль.', 'Нажмите «Проверить подключение».'],
    docsUrl: 'https://opensubsonic.github.io/docs/',
  },
  status: async (ctx) => {
    const c = await ctx.getConfig('subsonic');
    return c.url && (c.apiKey || (c.username && c.password)) ? { state: 'ready', account: c.username || undefined, detail: c.url } : { state: 'needs_setup', detail: 'Нужны адрес сервера и вход' };
  },
  verify: async (ctx) => {
    const r = await call(ctx, 'ping');
    return `Подключено: ${r.type ?? 'сервер Subsonic'}${r.serverVersion ? ` ${r.serverVersion}` : ''}.`;
  },

  async search(ctx, q, limit) {
    const c = await config(ctx);
    const r = await call(ctx, 'search3', { query: q, songCount: limit, albumCount: 8, artistCount: 5 });
    const res = r.searchResult3 ?? {};
    return {
      ...emptySearch(),
      tracks: songs(res.song).map((s) => mapChild(s, c)),
      albums: songs(res.album).map((a) => ({ source: 'subsonic', id: a.id, title: a.name ?? a.title, artist: a.artist ?? '', coverUrl: coverRef(a.coverArt), year: a.year, trackCount: a.songCount })),
      artists: songs(res.artist).map((a) => ({ source: 'subsonic', id: a.id, name: a.name, imageUrl: coverRef(a.coverArt) })),
    };
  },

  async discover(ctx, req) {
    const c = await config(ctx);
    const jobs = [call(ctx, 'getRandomSongs', { size: Math.min(req.limit, 100) }), ...req.tags.slice(0, 3).map((genre) => call(ctx, 'getSongsByGenre', { genre, count: 20 }))];
    const results = await Promise.allSettled(jobs);
    if (results.every((r) => r.status === 'rejected')) throw (results[0] as PromiseRejectedResult).reason;
    return results.flatMap((r) => (r.status === 'fulfilled' ? songs(r.value.randomSongs?.song ?? r.value.songsByGenre?.song).map((s) => mapChild(s, c)) : []));
  },

  async albumTracks(ctx, id) { const c = await config(ctx); return songs((await call(ctx, 'getAlbum', { id })).album?.song).map((s) => mapChild(s, c)); },
  async artistTracks(ctx, id) {
    const c = await config(ctx);
    const albums = songs((await call(ctx, 'getArtist', { id })).artist?.album).slice(0, 8);
    const out: RemoteTrack[] = [];
    for (const a of albums) out.push(...songs((await call(ctx, 'getAlbum', { id: a.id })).album?.song).map((s) => mapChild(s, c)));
    return out;
  },
  async userPlaylists(ctx) {
    return songs((await call(ctx, 'getPlaylists')).playlists?.playlist).map((p) => ({ source: 'subsonic', id: p.id, title: p.name, owner: p.owner, trackCount: p.songCount }));
  },
  async playlistTracks(ctx, id) { const c = await config(ctx); return songs((await call(ctx, 'getPlaylist', { id })).playlist?.entry).map((s) => mapChild(s, c)); },
  async likedTracks(ctx) { const c = await config(ctx); return songs((await call(ctx, 'getStarred2')).starred2?.song).map((s) => mapChild(s, c)); },

  async resolveStream(ctx, t, q: QualityPreference) {
    const c = await config(ctx);
    const original = q === 'lossless' || q === 'high';
    const params = original ? { id: t.sourceTrackId, format: 'raw' } : { id: t.sourceTrackId, maxBitRate: q === 'data_saver' ? 96 : 192 };
    return { uri: endpoint(c, 'stream', params), quality: original ? t.quality : { bitrateKbps: q === 'data_saver' ? 96 : 192 } };
  },

  async lyrics(ctx, t): Promise<Lyrics | null> {
    try {
      const r = await call(ctx, 'getLyricsBySongId', { id: t.sourceTrackId });
      const item = r.lyricsList?.structuredLyrics?.[0];
      if (item?.line?.length) {
        return { synced: !!item.synced, origin: 'ваш медиасервер', lines: item.line.map((l: any) => ({ timeMs: item.synced ? l.start : undefined, text: l.value })) };
      }
    } catch { /* расширение могло не поддерживаться */ }
    const old = await call(ctx, 'getLyrics', { artist: t.artist, title: t.title }).catch(() => null);
    return old?.lyrics?.value ? parseLyrics(old.lyrics.value, 'ваш медиасервер') : null;
  },

  async onPlayFinished(ctx, t) { await call(ctx, 'scrobble', { id: t.sourceTrackId, submission: 'true' }).catch(() => undefined); },
};
