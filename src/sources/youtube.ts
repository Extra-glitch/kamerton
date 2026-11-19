// YouTube: поиск песен и клипов через YouTube Data API и прослушивание во встроенном плеере.
// Звук нельзя отделять от видео, продолжать в фоне и закрывать плеер другими элементами.

import type { MusicVideo, RemoteTrack } from '@/core/types';
import { HttpError, httpJson, query } from '@/net/http';
import { caps, emptySearch, type MusicSourceAdapter, type SourceContext } from './types';

export const youtube: MusicSourceAdapter = {
  id: 'youtube', name: 'YouTube', category: 'commercial',
  capabilities: caps({ playback: 'visible-embed', requiresVisiblePlayer: true, auth: 'apiKey', supportsDeepLink: true, supportsSearch: true }),
  configFields: [{ key: 'apiKey', label: 'Ключ YouTube Data API', secret: true, required: true, hint: 'Бесплатный ключ из Google Cloud. Он нужен для поиска. Песни играют в видимом плеере YouTube: ключ не даёт права скачивать, извлекать звук (MP3) или слушать в фоне.' }],
  doc: {
    summary: 'Поиск песен и клипов на YouTube и прослушивание целиком во встроенном плеере YouTube. Песни, найденные в каталоге Deezer или Apple, тоже играют целиком: их полная версия ищется на YouTube при нажатии.',
    limits: [
      'В России YouTube заблокирован: без VPN плеер не загрузится. VPN в приложение не встроен.',
      'Видео играет со своим звуком, плеер Камертона на это время ставится на паузу.',
      'По правилам YouTube плеер должен быть виден: при сворачивании видео останавливается, фона и экрана блокировки нет.',
      'Скачивать видео и звук с YouTube правила запрещают, поэтому сохранения на телефон нет.',
      'Бесплатный ключ API — это доступ к поиску, а не разрешение на скачивание, извлечение звука (MP3) или фоновое воспроизведение.',
      'Камертон пользуется сервисами YouTube API. Политика конфиденциальности Google: google.com/policies/privacy.',
      'Бесплатный ключ даёт около 100 поисков в сутки. Поиск полной версии для песни из каталога тоже тратит один поиск, но только в первый раз: найденное запоминается.',
    ],
    unconfirmed: ['Работа встроенного плеера на телефоне не проверена.'],
    setup: [
      'Откройте console.cloud.google.com и войдите в аккаунт Google (нужен VPN).',
      'Создайте проект: вверху «Select a project» → «New project» → любое имя → «Create».',
      'Откройте «APIs & Services» → «Library», найдите «YouTube Data API v3» и нажмите «Enable».',
      'Откройте «APIs & Services» → «Credentials» → «Create credentials» → «API key».',
      'В настройках ключа в «API restrictions» выберите «Restrict key» и отметьте только YouTube Data API v3.',
      'Скопируйте ключ и вставьте его сюда. Ключ хранится только на телефоне в защищённом хранилище.',
    ],
    docsUrl: 'https://developers.google.com/youtube/iframe_api_reference',
  },
  status: async (ctx) => ((await ctx.getConfig('youtube')).apiKey ? { state: 'ready', detail: 'Поиск и видимый плеер, без фона и скачивания. В России нужен VPN' } : { state: 'needs_setup', detail: 'Нужен бесплатный ключ YouTube' }),
  async search(ctx, q, limit, page = 0) {
    const out = emptySearch();
    const r = await searchYouTube(ctx, q, Math.min(limit, 25), page);
    out.tracks = r.tracks;
    out.hasMore = r.hasMore;
    return out;
  },
  canHandleLink: (url) => !!parseYouTubeId(url) && /youtu/i.test(url),
  async resolveLink(_ctx, url) {
    const id = parseYouTubeId(url);
    if (!id) return null;
    const o = await httpJson<any>(`https://www.youtube.com/oembed?${query({ format: 'json', url: `https://www.youtube.com/watch?v=${id}` })}`, { service: 'YouTube', retries: 0 })
      .catch(() => { throw new HttpError('offline', 'YouTube недоступен. В России для него нужен VPN.'); });
    return { title: o.title, tracks: [mapYouTubeOembed(id, o)] };
  },
  verify: async (ctx) => { await findVideo(ctx, 'test', 'music'); return 'Ключ принят.'; },
  externalUrl: (v) => `https://www.youtube.com/results?search_query=${encodeURIComponent(`${v.artist} ${v.title}`)}`,
};

export function mapYouTubeOembed(id: string, o: any): RemoteTrack {
  const raw = String(o.title ?? 'YouTube').trim();
  const author = String(o.author_name ?? '').replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').trim();
  // Название видео часто имеет вид «Исполнитель - Песня (Official Video)».
  const m = raw.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  const title = (m ? m[2] : raw).replace(/\s*[([](official|официальн|lyric|audio|music video|клип|mood video)[^)\]]*[)\]]/gi, '').trim();
  return {
    source: 'youtube', sourceTrackId: id, title: title || raw, artist: m ? m[1].trim() : author || 'YouTube', explicit: 'unknown',
    coverUrl: o.thumbnail_url, availability: 'full', externalUrl: `https://www.youtube.com/watch?v=${id}`, canOffline: false,
    attribution: 'Плеер YouTube', extra: { embed: { provider: 'youtube', id } },
  };
}

const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

/** PT3M5S → 185 секунд. */
export function isoDuration(v?: string): number | undefined {
  const m = v?.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return undefined;
  const [, d, h, mi, s] = m.map((x) => Number(x ?? 0));
  return d * 86400 + h * 3600 + mi * 60 + s || undefined;
}

/** Видео из поиска YouTube как трек. Каналы «Исполнитель - Topic» содержат саму песню. */
export function mapYouTubeVideo(item: any, details?: any): RemoteTrack {
  const id = typeof item.id === 'string' ? item.id : item.id?.videoId;
  const sn = item.snippet ?? {};
  const t = mapYouTubeOembed(id, { title: decode(String(sn.title ?? '')), author_name: decode(String(sn.channelTitle ?? '')), thumbnail_url: sn.thumbnails?.high?.url ?? sn.thumbnails?.medium?.url });
  const topic = /\s-\sTopic$/i.test(String(sn.channelTitle ?? ''));
  if (topic) { t.artist = decode(String(sn.channelTitle)).replace(/\s-\sTopic$/i, '').trim(); t.title = decode(String(sn.title)); }
  const blocked: string[] = details?.contentDetails?.regionRestriction?.blocked ?? [];
  const allowed: string[] | undefined = details?.contentDetails?.regionRestriction?.allowed;
  return {
    ...t,
    durationSec: isoDuration(details?.contentDetails?.duration),
    availability: blocked.includes('RU') || (allowed && !allowed.includes('RU')) ? 'region_blocked' : 'full',
    year: sn.publishedAt ? Number(String(sn.publishedAt).slice(0, 4)) : undefined,
    extra: { ...t.extra, topic, channel: decode(String(sn.channelTitle ?? '')) },
  };
}

const pageTokens = new Map<string, string>();

export async function searchYouTube(ctx: SourceContext, q: string, limit: number, page = 0): Promise<{ tracks: RemoteTrack[]; hasMore: boolean }> {
  const key = (await ctx.getConfig('youtube')).apiKey;
  if (!key) throw new HttpError('auth', 'YouTube: нужен ключ. Добавьте его в «Источники музыки».');
  const pageToken = page ? pageTokens.get(`${q}|${page}`) : undefined;
  if (page && !pageToken) return { tracks: [], hasMore: false };
  const r = await httpJson<any>(`https://www.googleapis.com/youtube/v3/search?${query({ part: 'snippet', type: 'video', videoCategoryId: 10, videoEmbeddable: 'true', maxResults: limit, q, regionCode: 'RU', relevanceLanguage: 'ru', pageToken, key })}`, { service: 'YouTube', retries: 0, timeoutMs: 9000 });
  if (r.nextPageToken) pageTokens.set(`${q}|${page + 1}`, r.nextPageToken);
  const items: any[] = (r.items ?? []).filter((x: any) => x.id?.videoId);
  // Длительность и ограничения по региону приходят отдельным запросом (1 единица квоты).
  const details = new Map<string, any>();
  if (items.length) {
    try {
      const d = await httpJson<any>(`https://www.googleapis.com/youtube/v3/videos?${query({ part: 'contentDetails,status', id: items.map((x) => x.id.videoId).join(','), key })}`, { service: 'YouTube', retries: 0, timeoutMs: 8000 });
      for (const v of d.items ?? []) details.set(v.id, v);
    } catch { /* без длительности поиск всё равно полезен */ }
  }
  const tracks = items.map((x) => mapYouTubeVideo(x, details.get(x.id.videoId))).filter((t) => details.get(t.sourceTrackId)?.status?.embeddable !== false);
  return { tracks, hasMore: !!r.nextPageToken };
}

export function parseYouTubeId(input: string): string | null {
  const s = input.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  return s.match(/(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/)([\w-]{11})/)?.[1] ?? null;
}

export async function findVideo(ctx: SourceContext, artist: string, title: string): Promise<MusicVideo | null> {
  const key = (await ctx.getConfig('youtube')).apiKey;
  if (!key) return null;
  const r = await httpJson<any>(`https://www.googleapis.com/youtube/v3/search?${query({ part: 'snippet', type: 'video', videoCategoryId: 10, videoEmbeddable: 'true', maxResults: 5, q: `${artist} ${title} official video`, key })}`, { service: 'YouTube' });
  const items: any[] = r.items ?? [];
  const norm = (s: string) => s.toLowerCase();
  // Клип должен относиться к этому исполнителю и этой песне, иначе лучше ничего не показывать.
  const hit = items.find((i) => {
    const text = norm(`${i.snippet?.title} ${i.snippet?.channelTitle}`);
    return text.includes(norm(artist)) && text.includes(norm(title));
  });
  return hit ? { provider: 'youtube', videoId: hit.id.videoId, title: hit.snippet.title, origin: 'YouTube' } : null;
}
