// SoundCloud через официальный встраиваемый плеер и oEmbed: по ссылке, без ключа разработчика.
// Поиск по каталогу требует платного ключа и сервера, поэтому его нет.

import type { RemoteTrack } from '@/core/types';
import { HttpError, httpJson, query } from '@/net/http';
import { caps, type MusicSourceAdapter } from './types';

const LINK = /^https?:\/\/(?:www\.|m\.|on\.)?soundcloud\.com\/[^\s]+/i;

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

export const soundcloud: MusicSourceAdapter = {
  id: 'soundcloud', name: 'SoundCloud', category: 'independent',
  capabilities: caps({ playback: 'visible-embed', requiresVisiblePlayer: true, supportsDeepLink: true, supportsPlaylistImport: true }),
  doc: {
    summary: 'Треки и плейлисты SoundCloud по ссылке в официальном плеере SoundCloud внутри приложения.',
    limits: [
      'SoundCloud заблокирован в России с 2022 года: без VPN плеер не загрузится. VPN в приложение не встроен.',
      'Поиска нет: для него нужен платный ключ Artist Pro и сервер. Ссылку можно скопировать в приложении SoundCloud.',
      'Звук идёт из плеера SoundCloud, а не из плеера Камертона: без фона, экрана блокировки и очереди.',
      'Сохранить трек на телефон нельзя. Если автор включил кнопку «Скачать», скачайте файл на сайте SoundCloud и добавьте его в Камертон.',
    ],
    unconfirmed: ['Проигрывание в плеере SoundCloud на телефоне не проверено.'],
    setup: ['В приложении SoundCloud нажмите «Поделиться → Копировать ссылку».', 'Вставьте ссылку в поиск Камертона или в «Импорт → Ссылка».'],
    docsUrl: 'https://developers.soundcloud.com/docs/oembed',
  },
  status: async () => ({ state: 'ready', detail: 'По ссылке, в России нужен VPN' }),
  canHandleLink: isSoundCloudLink,
  externalUrl: (v) => v.externalUrl ?? `https://soundcloud.com/search?q=${encodeURIComponent(`${v.artist} ${v.title}`)}`,
  async resolveLink(_ctx, url) {
    if (!isSoundCloudLink(url)) return null;
    const o = await httpJson<any>(`https://soundcloud.com/oembed?${query({ format: 'json', url: url.trim() })}`, { service: 'SoundCloud', retries: 0 })
      .catch((e: HttpError) => { throw new HttpError(e.kind ?? 'offline', e.kind === 'not_found' ? 'SoundCloud: по ссылке ничего нет или запись закрыта.' : 'SoundCloud недоступен. В России для него нужен VPN.'); });
    const t = mapSoundCloudOembed(url, o);
    return { title: t.title, tracks: [t] };
  },
};
