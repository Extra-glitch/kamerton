// MusicBrainz: не более одного запроса в секунду, информативный User-Agent обязателен.

import { HttpError, httpJson, query, RateLimiter } from '@/net/http';
import { similarity } from '@/core/text';

const BASE = 'https://musicbrainz.org/ws/2';
const limiter = new RateLimiter(1100);

export interface MbRecording { mbid: string; title: string; artist: string; lengthSec?: number; isrcs: string[]; tags: string[]; year?: number; score: number; youtubeIds: string[] }

const get = (path: string, params: Record<string, string | number>) =>
  httpJson<any>(`${BASE}${path}?${query({ fmt: 'json', ...params })}`, { service: 'MusicBrainz', limiter, retries: 1 });

function toRecording(r: any): MbRecording {
  const youtubeIds: string[] = [];
  for (const rel of r.relations ?? []) {
    const id = String(rel.url?.resource ?? '').match(/(?:youtu\.be\/|[?&]v=)([\w-]{11})/)?.[1];
    if (id) youtubeIds.push(id);
  }
  return {
    mbid: r.id, title: r.title, artist: (r['artist-credit'] ?? []).map((a: any) => `${a.name}${a.joinphrase ?? ''}`).join('').trim(),
    lengthSec: r.length ? r.length / 1000 : undefined, isrcs: r.isrcs ?? [], tags: (r.tags ?? []).filter((t: any) => t.count > 0).map((t: any) => t.name),
    year: r['first-release-date'] ? Number(String(r['first-release-date']).slice(0, 4)) : undefined, score: r.score ?? 100, youtubeIds,
  };
}

const luceneEscape = (s: string) => s.replace(/([+\-!(){}[\]^"~*?:\\/]|&&|\|\|)/g, '\\$1');

export const musicBrainz = {
  async byIsrc(isrc: string): Promise<MbRecording[]> {
    try {
      const r = await get(`/isrc/${encodeURIComponent(isrc)}`, { inc: 'artist-credits+tags' });
      return (r.recordings ?? []).map((x: any) => ({ ...toRecording(x), isrcs: [isrc] }));
    } catch (e) {
      if (e instanceof HttpError && e.kind === 'not_found') return [];
      throw e;
    }
  },
  async search(artist: string, title: string): Promise<MbRecording[]> {
    const r = await get('/recording', { query: `recording:"${luceneEscape(title)}" AND artist:"${luceneEscape(artist)}"`, limit: 5 });
    return (r.recordings ?? []).map(toRecording);
  },
  async details(mbid: string): Promise<MbRecording> {
    return toRecording(await get(`/recording/${mbid}`, { inc: 'isrcs+tags+artist-credits+url-rels' }));
  },
  async artistId(name: string): Promise<string | null> {
    const r = await get('/artist', { query: `artist:"${luceneEscape(name)}"`, limit: 3 });
    const hit = (r.artists ?? []).find((a: any) => a.score >= 90 && similarity(a.name, name) >= 0.9);
    return hit?.id ?? null;
  },
  async releaseGroups(artistMbid: string): Promise<{ id: string; title: string; type?: string; date?: string }[]> {
    const r = await get('/release-group', { artist: artistMbid, limit: 100 });
    return (r['release-groups'] ?? []).map((g: any) => ({ id: g.id, title: g.title, type: g['primary-type'], date: g['first-release-date'] || undefined }));
  },
};

export type MusicBrainzClient = Pick<typeof musicBrainz, 'byIsrc' | 'search'>;

/** Ищет запись и возвращает её идентификаторы только при уверенном совпадении. */
export async function identify(mb: MusicBrainzClient, q: { artist: string; title: string; isrc?: string; durationSec?: number }): Promise<MbRecording | null> {
  const list = q.isrc ? await mb.byIsrc(q.isrc) : await mb.search(q.artist, q.title);
  const good = list.filter((r) => {
    const close = !q.durationSec || !r.lengthSec || Math.abs(q.durationSec - r.lengthSec) <= 5;
    if (q.isrc) return close;
    return r.score >= 85 && close && similarity(r.title, q.title) >= 0.92 && similarity(r.artist, q.artist) >= 0.85;
  });
  return good[0] ?? null;
}
