import type { RemoteTrack } from '@/core/types';
import { httpJson, HttpError, query, USER_AGENT } from '@/net/http';
import { caps, emptySearch, type MusicSourceAdapter } from './types';

const SERVICE = 'Radio Browser';
const DISCOVERY = 'https://all.api.radio-browser.info/json/servers';
// Запасные адреса нужны только если не удалось получить актуальный список серверов.
const FALLBACK = ['de1.api.radio-browser.info', 'de2.api.radio-browser.info', 'fi1.api.radio-browser.info'];

let servers: string[] | null = null;
export const resetRadioServers = () => { servers = null; };

async function serverList(): Promise<string[]> {
  if (servers) return servers;
  try {
    const list = await httpJson<{ name: string }[]>(DISCOVERY, { service: SERVICE, retries: 0, timeoutMs: 6000 });
    servers = shuffle([...new Set(list.map((s) => s.name))]);
  } catch {
    servers = shuffle([...FALLBACK]);
  }
  return servers;
}

function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

async function get<T = any>(path: string): Promise<T> {
  let last: unknown;
  for (const host of (await serverList()).slice(0, 4)) {
    try {
      return await httpJson<T>(`https://${host}${path}`, { service: SERVICE, retries: 0, headers: { 'User-Agent': USER_AGENT } });
    } catch (e) { last = e; }
  }
  throw last ?? new HttpError('offline', 'Radio Browser недоступен.');
}

export function mapStation(s: any): RemoteTrack {
  const tags = String(s.tags ?? '').split(',').map((t) => t.trim()).filter(Boolean).slice(0, 8);
  const place = [s.country, s.state].filter(Boolean).join(', ');
  return {
    source: 'radio', sourceTrackId: s.stationuuid, title: String(s.name ?? 'Радиостанция').trim(), artist: place || 'Интернет-радио',
    explicit: 'unknown', tags, coverUrl: s.favicon || undefined, availability: s.lastcheckok === 0 ? 'gone' : 'full', isLive: true,
    quality: { codec: s.codec || undefined, bitrateKbps: s.bitrate || undefined }, externalUrl: s.homepage || undefined,
    popularity: s.clickcount ?? undefined, canOffline: false, extra: { streamUrl: s.url_resolved || s.url },
  };
}

export const FILTERS = 'hidebroken=true&order=clickcount&reverse=true';

export const radio: MusicSourceAdapter = {
  id: 'radio', name: 'Radio Browser', category: 'radio',
  capabilities: caps({ playback: 'direct-stream', canBackground: true, canMixWithOtherSources: true, supportsSearch: true, supportsDeepLink: true, metadata: { genres: true } }),
  doc: {
    summary: 'Открытый каталог интернет-радиостанций со всего мира. Эфир играет в приложении.',
    limits: ['Это живой эфир: перемотки, длительности и текста песни нет.', 'Качество и работа потока зависят от станции.', 'Станции не участвуют в персональной волне.'],
    unconfirmed: ['Лицензия на данные каталога не подтверждена. Права на эфир принадлежат станциям.'],
    setup: ['Ничего настраивать не нужно.'],
    docsUrl: 'https://api.radio-browser.info',
  },
  status: async () => ({ state: 'ready' }),
  verify: async () => { const r = await get<any[]>(`/json/stations/topclick/1`); return r.length ? 'Каталог радио отвечает.' : 'Каталог ответил, но список пуст.'; },

  async search(_ctx, q, limit) {
    const out = emptySearch();
    const list = await get<any[]>(`/json/stations/search?${query({ name: q, limit })}&${FILTERS}`);
    out.tracks = list.map(mapStation);
    return out;
  },

  async resolveStream(_ctx, t) {
    const uri = String(t.extra?.streamUrl ?? '');
    if (!uri) throw new HttpError('not_found', 'У станции нет адреса потока.');
    return { uri, quality: t.quality };
  },

  // API просит сообщать о каждом запуске станции пользователем.
  async onPlayStarted(_ctx, t) { await get(`/json/url/${t.sourceTrackId}`).catch(() => undefined); },
};

export async function radioByTag(tag: string, limit = 30): Promise<RemoteTrack[]> {
  return (await get<any[]>(`/json/stations/bytag/${encodeURIComponent(tag)}?limit=${limit}&${FILTERS}`)).map(mapStation);
}
export async function radioTop(limit = 30): Promise<RemoteTrack[]> {
  return (await get<any[]>(`/json/stations/topclick/${limit}?hidebroken=true`)).map(mapStation);
}
export async function radioByCountry(code: string, limit = 30): Promise<RemoteTrack[]> {
  return (await get<any[]>(`/json/stations/bycountrycodeexact/${encodeURIComponent(code)}?limit=${limit}&${FILTERS}`)).map(mapStation);
}
