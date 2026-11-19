// YouTube используется только для клипов в видимом плеере.
// Звук нельзя отделять от видео, продолжать в фоне и закрывать плеер другими элементами.

import type { MusicVideo, RemoteTrack } from '@/core/types';
import { HttpError, httpJson, query } from '@/net/http';
import { caps, type MusicSourceAdapter, type SourceContext } from './types';

export const youtube: MusicSourceAdapter = {
  id: 'youtube', name: 'YouTube', category: 'commercial',
  capabilities: caps({ playback: 'visible-embed', requiresVisiblePlayer: true, auth: 'apiKey', supportsDeepLink: true }),
  configFields: [{ key: 'apiKey', label: 'Ключ YouTube Data API', secret: true, hint: 'Необязательно: нужен только для автоматического поиска клипов. Видео по ссылке работают и без него.' }],
  doc: {
    summary: 'Видео и клипы по ссылке в официальном плеере YouTube внутри приложения.',
    limits: [
      'В России YouTube заблокирован: без VPN плеер не загрузится. VPN в приложение не встроен.',
      'Видео играет со своим звуком, плеер Камертона на это время ставится на паузу.',
      'По правилам YouTube плеер должен быть виден: при сворачивании видео останавливается, фона и экрана блокировки нет.',
      'Скачивать видео и звук с YouTube правила запрещают, поэтому сохранения на телефон нет.',
    ],
    unconfirmed: ['Работа встроенного плеера на телефоне не проверена.'],
    setup: ['В приложении YouTube нажмите «Поделиться → Копировать ссылку».', 'Вставьте ссылку в поиск Камертона.', 'Для автопоиска клипов можно добавить ключ YouTube Data API из Google Cloud Console.'],
    docsUrl: 'https://developers.google.com/youtube/iframe_api_reference',
  },
  status: async (ctx) => ({ state: 'ready', detail: (await ctx.getConfig('youtube')).apiKey ? 'По ссылке и автопоиск клипов, в России нужен VPN' : 'По ссылке, в России нужен VPN' }),
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
