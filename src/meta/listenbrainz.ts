// Родственные исполнители из открытых данных ListenBrainz Labs.

import { artistKey } from '@/reco/engine';
import { httpJson, query, RateLimiter } from '@/net/http';
import { musicBrainz } from './musicbrainz';

const limiter = new RateLimiter(1100);
const ALGORITHM = 'session_based_days_7500_session_300_contribution_5_threshold_10_limit_100_filter_True_skip_30';
const memo = new Map<string, Map<string, number>>();

/** Возвращает ключ исполнителя и близость от 0 до 1. Пустой результат не считается ошибкой. */
export async function relatedArtists(name: string): Promise<Map<string, number>> {
  const key = artistKey(name);
  const hit = memo.get(key);
  if (hit) return hit;
  const mbid = await musicBrainz.artistId(name);
  const out = new Map<string, number>();
  if (mbid) {
    const r = await httpJson<any>(`https://labs.api.listenbrainz.org/similar-artists/json?${query({ artist_mbids: mbid, algorithm: ALGORITHM })}`, { service: 'ListenBrainz', limiter, retries: 0 });
    const rows: any[] = Array.isArray(r) ? r.flatMap((x) => (Array.isArray(x?.data) ? x.data : [x])) : [];
    const list = rows.filter((x) => x?.name && typeof x.score === 'number');
    const max = Math.max(1, ...list.map((x) => x.score));
    for (const x of list.slice(0, 40)) out.set(artistKey(x.name), x.score / max);
  }
  memo.set(key, out);
  return out;
}
