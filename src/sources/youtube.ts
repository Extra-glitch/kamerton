// YouTube используется только для клипов в видимом плеере.
// Звук нельзя отделять от видео, продолжать в фоне и закрывать плеер другими элементами.

import type { MusicVideo } from '@/core/types';
import { httpJson, query } from '@/net/http';
import { caps, type MusicSourceAdapter, type SourceContext } from './types';

export const youtube: MusicSourceAdapter = {
  id: 'youtube', name: 'YouTube (клипы)', category: 'commercial',
  capabilities: caps({ playback: 'visible-embed', requiresVisiblePlayer: true, auth: 'apiKey', supportsDeepLink: true }),
  configFields: [{ key: 'apiKey', label: 'Ключ YouTube Data API', secret: true, required: true, hint: 'Нужен для автоматического поиска клипов. Ссылку можно вставить и без ключа.' }],
  doc: {
    summary: 'Показ официальных клипов в видимом плеере YouTube.',
    limits: ['Видео играет со своим звуком, наш плеер на это время ставится на паузу.', 'При сворачивании клип останавливается.', 'Плеер не меньше 200×200 точек, без элементов поверх него.'],
    unconfirmed: ['Доступность YouTube в России ограничена.', 'Работа встроенного плеера на телефоне ещё не проверялась.'],
    setup: ['В Google Cloud Console включите YouTube Data API v3.', 'Создайте API-ключ и вставьте его сюда.'],
    docsUrl: 'https://developers.google.com/youtube',
  },
  status: async (ctx) => ((await ctx.getConfig('youtube')).apiKey ? { state: 'ready', detail: 'Поиск клипов включён' } : { state: 'needs_setup', detail: 'Без ключа клип можно добавить ссылкой' }),
  verify: async (ctx) => { await findVideo(ctx, 'test', 'music'); return 'Ключ принят.'; },
  externalUrl: (v) => `https://www.youtube.com/results?search_query=${encodeURIComponent(`${v.artist} ${v.title}`)}`,
};

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
