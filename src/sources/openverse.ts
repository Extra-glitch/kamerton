// Openverse: открытый поисковик WordPress по музыке под лицензиями Creative Commons
// (Jamendo, Wikimedia Commons, ccMixter, Freesound и другие). Ключ не нужен.
// Лицензия каждого трека разрешает слушать и сохранять его, поэтому он играет целиком, в фоне и офлайн.

import type { RemoteTrack } from '@/core/types';
import { httpJson, query, RateLimiter } from '@/net/http';
import { caps, emptySearch, type MusicSourceAdapter } from './types';

const BASE = 'https://api.openverse.org/v1';
// Без регистрации Openverse отдаёт до 20 результатов за запрос и ограничивает частоту запросов.
const limiter = new RateLimiter(1000);
const LICENSE: Record<string, string> = { by: 'CC BY', 'by-sa': 'CC BY-SA', 'by-nc': 'CC BY-NC', 'by-nd': 'CC BY-ND', 'by-nc-sa': 'CC BY-NC-SA', 'by-nc-nd': 'CC BY-NC-ND', cc0: 'CC0', pdm: 'общественное достояние', sampling: 'Sampling+', 'nc-sampling': 'NC Sampling+' };

export function mapOpenverseAudio(a: any): RemoteTrack | null {
  const url = String(a.url ?? '');
  if (!/^https?:\/\//.test(url)) return null;
  const lic = LICENSE[String(a.license ?? '').toLowerCase()] ?? String(a.license ?? '').toUpperCase();
  return {
    source: 'openverse', sourceTrackId: String(a.id), title: String(a.title ?? 'Без названия').trim(), artist: String(a.creator ?? 'Неизвестный автор').trim(),
    album: a.audio_set?.title || undefined, durationSec: a.duration ? Math.round(Number(a.duration) / 1000) : undefined,
    // Openverse помечает «взрослое» содержимое, но не говорит, цензурная ли это версия песни.
    explicit: a.mature ? 'explicit' : 'unknown', tags: Array.isArray(a.genres) ? a.genres.map(String) : [],
    coverUrl: a.thumbnail || undefined, availability: 'full', canOffline: true,
    quality: { codec: a.filetype ? String(a.filetype).toUpperCase() : undefined, bitrateKbps: a.bit_rate ? Math.round(Number(a.bit_rate) / 1000) : undefined },
    attribution: `${lic}${a.license_version ? ` ${a.license_version}` : ''}, ${a.provider ?? a.source ?? 'Openverse'}`, externalUrl: a.foreign_landing_url || undefined,
    extra: { stream: url, license: a.license, licenseUrl: a.license_url, provider: a.provider },
  };
}

export const openverse: MusicSourceAdapter = {
  id: 'openverse', name: 'Openverse', category: 'open',
  capabilities: caps({ playback: 'direct-stream', canBackground: true, canOffline: true, auth: 'none', supportsSearch: true, attributionRequired: true, metadata: { genres: true } }),
  doc: {
    summary: 'Музыка под свободными лицензиями из многих открытых каталогов сразу: Jamendo, Wikimedia Commons, ccMixter и другие. Играет целиком, в фоне и сохраняется на телефон.',
    limits: [
      'Здесь в основном независимые музыканты: популярных песен крупных лейблов нет.',
      'Без регистрации: до 20 результатов за запрос и ограничение частоты запросов.',
      'Некоторые лицензии запрещают коммерческое использование. Для прослушивания и личной копии это не мешает.',
    ],
    unconfirmed: ['Работа из России без VPN не проверена.'],
    setup: ['Ничего настраивать не нужно.'],
    docsUrl: 'https://api.openverse.org/v1/',
  },
  status: async () => ({ state: 'ready', detail: 'Свободная музыка, ключ не нужен' }),
  externalUrl: (v) => v.externalUrl ?? null,
  async search(_ctx, q, limit) {
    const out = emptySearch();
    const r = await httpJson<{ results?: any[] }>(`${BASE}/audio/?${query({ q, page_size: Math.min(20, limit), category: 'music', filter_dead: 'true' })}`, { service: 'Openverse', limiter });
    out.tracks = (r.results ?? []).map(mapOpenverseAudio).filter((t): t is RemoteTrack => !!t);
    return out;
  },
  async resolveStream(_ctx, t) {
    return { uri: String(t.extra?.stream ?? ''), quality: t.quality };
  },
};
