import { rankCandidates, type MatchQuery, type MatchResult, type MatchStatus } from '@/core/match';
import type { RemoteTrack } from '@/core/types';
import { identify, type MbRecording, type MusicBrainzClient } from '@/meta/musicbrainz';
import { mapLimit } from '@/net/http';
import type { ImportItem } from './formats';

export interface ImportRow {
  item: ImportItem;
  status: MatchStatus;
  best?: RemoteTrack;
  score: number;
  notes: string[];
  alternatives: MatchResult[];
  recording?: MbRecording;
  /** Решение пользователя при проверке. */
  decision?: 'accept' | 'reject';
}

export interface MatchDeps {
  /** Поиск кандидатов в подключённых источниках. Каждая функция может упасть независимо. */
  searchers: ((q: string) => Promise<RemoteTrack[]>)[];
  musicBrainz?: MusicBrainzClient;
  onProgress?: (done: number, total: number) => void;
}

export async function matchItem(item: ImportItem, deps: MatchDeps): Promise<ImportRow> {
  let recording: MbRecording | null = null;
  const notes: string[] = [];
  if (deps.musicBrainz && item.artist) {
    try { recording = await identify(deps.musicBrainz, item); }
    catch { notes.push('MusicBrainz не ответил, сопоставили по названию'); }
  }
  const query: MatchQuery = {
    title: item.title, artist: item.artist || recording?.artist || '', album: item.album, durationSec: item.durationSec ?? recording?.lengthSec,
    isrc: item.isrc, mbid: item.mbid ?? recording?.mbid, isrcsFromMusicBrainz: recording?.isrcs,
  };
  const text = `${query.artist} ${item.title}`.trim();
  const found = await Promise.allSettled(deps.searchers.map((s) => s(text)));
  const seen = new Set<string>();
  const candidates: RemoteTrack[] = [];
  for (const r of found) {
    if (r.status !== 'fulfilled') continue;
    for (const c of r.value) {
      const k = `${c.source}:${c.sourceTrackId}`;
      if (!seen.has(k) && !c.isLive) { seen.add(k); candidates.push(c); }
    }
  }
  const ranked = query.artist ? rankCandidates(query, candidates) : rankCandidates(query, candidates).map(capNoArtist);
  const top = ranked[0];
  if (!top || top.status === 'missing') {
    return { item, status: 'missing', score: top?.score ?? 0, notes, alternatives: ranked.filter((r) => r.score >= 0.5).slice(0, 5), recording: recording ?? undefined };
  }
  return { item, status: top.status, best: top.candidate, score: top.score, notes: [...notes, ...top.notes], alternatives: ranked.slice(1, 6), recording: recording ?? undefined };
}

/** Без имени исполнителя уверенным совпадение считать нельзя. */
function capNoArtist(r: MatchResult): MatchResult {
  return r.status === 'matched' ? { ...r, status: 'doubtful', score: Math.min(r.score, 0.85), notes: [...r.notes, 'исполнитель не указан в исходном списке'] } : r;
}

export async function matchAll(items: ImportItem[], deps: MatchDeps): Promise<ImportRow[]> {
  let done = 0;
  return mapLimit(items, 3, async (item) => {
    const row = await matchItem(item, deps);
    deps.onProgress?.(++done, items.length);
    return row;
  });
}

export function summarize(rows: ImportRow[]) {
  const s = { matched: 0, doubtful: 0, missing: 0 };
  for (const r of rows) {
    if (r.status === 'matched') s.matched++;
    else if (r.status === 'missing') s.missing++;
    else s.doubtful++;
  }
  return s;
}
