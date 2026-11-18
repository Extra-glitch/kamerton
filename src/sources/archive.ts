import type { Availability, RemoteTrack } from '@/core/types';
import { HttpError, httpJson, mapLimit, query } from '@/net/http';
import { caps, DIRECT, emptySearch, type AlbumRef, type MusicSourceAdapter, type QualityPreference } from './types';

const BASE = 'https://archive.org';
const SERVICE = 'Internet Archive';
const COLLECTIONS = '(collection:netlabels OR collection:etree OR collection:georgeblood OR collection:audio_music)';

async function searchIds(q: string, rows: number, sort?: string): Promise<string[]> {
  const url = `${BASE}/advancedsearch.php?${query({ q, 'fl[]': 'identifier', rows, page: 1, output: 'json', 'sort[]': sort })}`;
  const r = await httpJson<{ response?: { docs?: { identifier: string }[] } }>(url, { service: SERVICE });
  return (r.response?.docs ?? []).map((d) => d.identifier);
}

const first = (v: unknown): string | undefined => (Array.isArray(v) ? v[0] : (v as string | undefined));
const list = (v: unknown): string[] => (Array.isArray(v) ? v : v ? String(v).split(/[;,]/) : []).map((s: string) => s.trim()).filter(Boolean);

function seconds(v?: string): number | undefined {
  if (!v) return undefined;
  if (v.includes(':')) return v.split(':').reduce((acc, x) => acc * 60 + Number(x), 0);
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

type Tier = 'lossless' | 'high' | 'low';
function tierOf(format: string): Tier | null {
  const f = format.toLowerCase();
  if (f.includes('flac') || f === 'apple lossless audio' || f === 'wave') return f === 'wave' ? null : 'lossless';
  if (f === 'vbr mp3' || f === 'mp3' || f === '320kbps mp3' || f === '256kbps mp3' || f === '192kbps mp3') return 'high';
  if (f === 'ogg vorbis' || f === '128kbps mp3' || f === '64kbps mp3' || f === '96kbps mp3') return 'low';
  return null;
}

/** Основа имени файла без расширения и суффиксов производных форматов. */
const stem = (name: string) => name.replace(/\.[^.]+$/, '').replace(/(_vbr|_64kb|_128kb|_256kb|_320kb)$/i, '');
const fileUrl = (id: string, name: string) => `${BASE}/download/${encodeURIComponent(id)}/${name.split('/').map(encodeURIComponent).join('/')}`;

export function mapArchiveItem(meta: any): RemoteTrack[] {
  const m = meta?.metadata;
  if (!m?.identifier || meta.is_dark) return [];
  const id: string = m.identifier;
  const restricted = m['access-restricted-item'] === 'true' || m['access-restricted-item'] === true;
  const streamOnly = String(m.stream_only ?? '').toLowerCase() === 'true';
  const groups = new Map<string, any[]>();
  for (const f of meta.files ?? []) {
    if (!f?.name || !tierOf(String(f.format ?? ''))) continue;
    const k = stem(f.name);
    groups.set(k, [...(groups.get(k) ?? []), f]);
  }
  const album = first(m.title);
  const creator = first(m.creator) ?? first(m.artist) ?? 'Неизвестный исполнитель';
  const tags = list(m.subject).slice(0, 10);
  const year = Number(String(first(m.year) ?? first(m.date) ?? '').slice(0, 4)) || undefined;
  const cover = `${BASE}/services/img/${encodeURIComponent(id)}`;
  const availability: Availability = restricted ? 'subscription_required' : 'full';
  const tracks: (RemoteTrack & { sortKey: number })[] = [];

  for (const [key, files] of groups) {
    const usable = files.filter((f) => !f.private || f.private === 'false');
    if (!usable.length) continue;
    const pick: Partial<Record<Tier, string>> = {};
    for (const f of usable) { const t = tierOf(String(f.format))!; pick[t] ??= f.name; }
    const best = usable.find((f) => f.title) ?? usable.find((f) => f.source === 'original') ?? usable[0];
    const lengthFile = usable.find((f) => f.length) ?? best;
    const trackNo = parseInt(String(best.track ?? ''), 10);
    const hasPrivate = files.length !== usable.length;
    tracks.push({
      source: 'archive', sourceTrackId: `${id}/${key}`, title: best.title || key.split('/').pop()!.replace(/[_-]+/g, ' ').trim(),
      artist: best.artist || best.creator || creator, album, albumId: id, trackNumber: Number.isFinite(trackNo) ? trackNo : undefined,
      durationSec: seconds(lengthFile.length), explicit: 'unknown', tags, year, releaseDate: first(m.date), coverUrl: cover, availability,
      quality: pick.lossless ? { codec: 'FLAC', lossless: true } : { codec: pick.high ? 'MP3' : 'Ogg/MP3' },
      licenseUrl: m.licenseurl || undefined, attribution: `${creator}, Internet Archive`, externalUrl: `${BASE}/details/${id}`,
      popularity: Number(m.downloads) || undefined, canOffline: !streamOnly && !hasPrivate && !restricted, extra: { identifier: id, files: pick },
      sortKey: Number.isFinite(trackNo) ? trackNo : tracks.length + 1000,
    });
  }
  return tracks.sort((a, b) => a.sortKey - b.sortKey).map(({ sortKey: _s, ...t }) => t);
}

async function metadata(id: string) { return httpJson<any>(`${BASE}/metadata/${encodeURIComponent(id)}`, { service: SERVICE, timeoutMs: 20000 }); }
async function itemsToTracks(ids: string[], perItem: number) {
  const metas = await mapLimit(ids, 3, (id) => metadata(id).catch(() => null));
  return metas.flatMap((m) => (m ? mapArchiveItem(m).slice(0, perItem) : []));
}

const escapeQ = (s: string) => s.replace(/["\\:()[\]{}^~*?+\-!&|/]/g, ' ').trim();

export const archive: MusicSourceAdapter = {
  id: 'archive', name: 'Internet Archive', category: 'open',
  capabilities: caps({ ...DIRECT, canOffline: true, supportsSearch: true, supportsDiscovery: true, supportsPlaylistImport: true, supportsDeepLink: true, attributionRequired: true, metadata: { genres: true, license: true } }),
  doc: {
    summary: 'Концерты Live Music Archive, нетлейблы и оцифровки пластинок. Часто есть FLAC.',
    limits: ['Качество и полнота описаний зависят от того, кто загрузил запись.', 'Некоторые концерты разрешено только слушать онлайн, скачивание для них отключено.', 'Live Music Archive предназначен для некоммерческого использования.', 'ISRC и метки цензуры архив не содержит.'],
    unconfirmed: ['Официальных лимитов запросов нет: при ответе 429 приложение ждёт.', 'Доступность из России нужно проверить на телефоне.'],
    setup: ['Ничего настраивать не нужно.'],
    docsUrl: 'https://archive.org/developers',
  },
  status: async () => ({ state: 'ready' }),
  verify: async () => { const r = await searchIds(`${COLLECTIONS} AND mediatype:audio`, 1); return r.length ? 'Архив отвечает.' : 'Архив ответил, но список пуст.'; },
  canHandleLink: (url) => /archive\.org\/details\//i.test(url),
  externalUrl: (q) => q.externalUrl ?? `${BASE}/search?query=${encodeURIComponent(`${q.artist} ${q.title}`)}`,

  async search(_ctx, q, limit) {
    const out = emptySearch();
    const ids = await searchIds(`${COLLECTIONS} AND mediatype:audio AND (${escapeQ(q)})`, 6, 'downloads desc');
    const metas = await mapLimit(ids, 3, (id) => metadata(id).catch(() => null));
    for (const m of metas) {
      const tracks = m ? mapArchiveItem(m) : [];
      if (!tracks.length) continue;
      out.tracks.push(...tracks.slice(0, 4));
      out.albums.push({ source: 'archive', id: m.metadata.identifier, title: first(m.metadata.title) ?? m.metadata.identifier, artist: tracks[0].artist, coverUrl: tracks[0].coverUrl, year: tracks[0].year, trackCount: tracks.length } satisfies AlbumRef);
    }
    out.tracks = out.tracks.slice(0, limit);
    return out;
  },

  async discover(_ctx, req) {
    const terms = [...req.tags, ...req.artists].slice(0, 5).map(escapeQ).filter(Boolean);
    const topic = terms.length ? ` AND (${terms.map((t) => `subject:"${t}" OR creator:"${t}"`).join(' OR ')})` : '';
    const sort = req.mode === 'fresh' ? 'publicdate desc' : req.mode === 'rare' ? 'addeddate desc' : 'downloads desc';
    const ids = await searchIds(`(collection:netlabels OR collection:etree) AND mediatype:audio${topic}`, 6, sort);
    return itemsToTracks(ids, Math.max(2, Math.ceil(req.limit / 6)));
  },

  async albumTracks(_ctx, id) { return mapArchiveItem(await metadata(id)); },

  async resolveLink(_ctx, url) {
    const id = url.match(/archive\.org\/details\/([^/?#]+)/i)?.[1];
    if (!id) return null;
    const m = await metadata(decodeURIComponent(id));
    return { title: first(m?.metadata?.title) ?? id, tracks: mapArchiveItem(m) };
  },

  async resolveStream(_ctx, t, q: QualityPreference) {
    const { identifier, files } = (t.extra ?? {}) as { identifier?: string; files?: Partial<Record<Tier, string>> };
    if (!identifier || !files) throw new HttpError('not_found', 'В записи архива нет подходящего файла.');
    const order: Tier[] = q === 'lossless' ? ['lossless', 'high', 'low'] : q === 'data_saver' ? ['low', 'high', 'lossless'] : ['high', 'low', 'lossless'];
    const tier = order.find((x) => files[x]);
    if (!tier) throw new HttpError('not_found', 'В записи архива нет подходящего файла.');
    return { uri: fileUrl(identifier, files[tier]!), quality: tier === 'lossless' ? { codec: 'FLAC', lossless: true } : { codec: tier === 'high' ? 'MP3' : 'Ogg/MP3' } };
  },
};
