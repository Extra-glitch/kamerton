// Сопоставление композиции с кандидатами из других источников.

import type { ExplicitState, RemoteTrack, VersionTag } from './types';
import { parseTitle, resolveExplicit, versionConflicts, versionLabel } from './versions';
import { normalizeText, similarity, splitArtists } from './text';

export interface MatchQuery {
  title: string;
  artist: string;
  album?: string;
  durationSec?: number;
  isrc?: string;
  mbid?: string;
  isrcsFromMusicBrainz?: string[];
}

export type MatchStatus = 'matched' | 'doubtful' | 'clean_only' | 'other_version' | 'missing';

export interface MatchResult {
  candidate: RemoteTrack;
  score: number;
  status: MatchStatus;
  notes: string[];
  conflicts: VersionTag[];
  /** Сходство до штрафа за другую версию: нужно, чтобы ближайшая запись шла первой. */
  rawScore: number;
}

const TITLE_MIN = 0.92;
const ARTIST_MIN = 0.9;

function artistScore(a: string, b: string): number {
  const left = splitArtists(a);
  const right = splitArtists(b);
  let best = similarity(a, b);
  for (const x of left) for (const y of right) best = Math.max(best, similarity(x, y));
  return best;
}

function sameIsrc(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  return a.replace(/[^a-z0-9]/gi, '').toUpperCase() === b.replace(/[^a-z0-9]/gi, '').toUpperCase();
}

export function scoreCandidate(query: MatchQuery, c: RemoteTrack): MatchResult {
  const q = parseTitle(query.title);
  const cand = parseTitle(c.title);
  const candExplicit: ExplicitState = resolveExplicit(c.explicit, cand.versionTags);
  const qExplicit: ExplicitState = resolveExplicit('unknown', q.versionTags);
  const conflicts = versionConflicts(q.versionTags, qExplicit, cand.versionTags, candExplicit);
  // Обратный случай: искали ремикс, а нашли оригинал. Это тоже другая запись.
  const missingVersion = versionConflicts(cand.versionTags, candExplicit, q.versionTags, qExplicit);

  const titleSim = similarity(q.coreTitle || query.title, cand.coreTitle || c.title);
  const artistSim = artistScore(query.artist, c.artist);
  const notes: string[] = [];
  let score = titleSim * 0.55 + artistSim * 0.35;

  const diff = query.durationSec && c.durationSec ? Math.abs(query.durationSec - c.durationSec) : undefined;
  if (diff === undefined) score += 0.05;
  else if (diff <= 3) score += 0.1;
  else if (diff <= 10) score += 0.05;
  else if (diff > 30) {
    score -= 0.2;
    notes.push(`длительность отличается на ${Math.round(diff)} с`);
  } else {
    score -= 0.05;
    notes.push(`длительность отличается на ${Math.round(diff)} с`);
  }

  if (query.album && c.album && normalizeText(query.album) === normalizeText(c.album)) score += 0.02;

  const isrcHit = sameIsrc(query.isrc, c.isrc) || (query.isrcsFromMusicBrainz ?? []).some((x) => sameIsrc(x, c.isrc));
  const mbidHit = !!query.mbid && query.mbid === c.mbid;
  if (isrcHit || mbidHit) {
    // ISRC сильный, но не окончательный признак: один код иногда стоит на разных версиях.
    score = diff !== undefined && diff > 5 ? Math.max(score, 0.8) : Math.max(score, 0.99);
    notes.unshift(mbidHit ? 'совпал MusicBrainz ID' : 'совпал ISRC');
  } else if (titleSim < TITLE_MIN || artistSim < ARTIST_MIN) {
    score = Math.min(score, 0.84);
  }
  score = Math.max(0, Math.min(1, score));

  const rawScore = score;
  let status: MatchStatus;
  const onlyCensorship = conflicts.length > 0 && conflicts.every((t) => t === 'clean' || t === 'radio_edit');
  if (conflicts.length || missingVersion.length) {
    const named = [...conflicts, ...missingVersion].map(versionLabel).join(', ').toLowerCase();
    notes.push(`отличие: ${named}`);
    const samePiece = titleSim >= TITLE_MIN && artistSim >= ARTIST_MIN;
    status = samePiece || isrcHit || mbidHit ? (onlyCensorship && !missingVersion.length ? 'clean_only' : 'other_version') : 'missing';
    score = Math.min(score, 0.7);
  } else if (score >= 0.9) status = 'matched';
  else if (score >= 0.72) status = 'doubtful';
  else status = 'missing';

  return { candidate: c, score, status, notes, conflicts, rawScore };
}

const STATUS_RANK: Record<MatchStatus, number> = { matched: 0, doubtful: 1, clean_only: 2, other_version: 3, missing: 4 };
const EXPLICIT_RANK: Record<ExplicitState, number> = { explicit: 0, not_explicit: 1, unknown: 2, clean: 3 };

/** Лучшие кандидаты: при равенстве выше оригинал без цензуры, затем более длинная запись. */
export function rankCandidates(query: MatchQuery, candidates: RemoteTrack[]): MatchResult[] {
  return candidates
    .map((c) => scoreCandidate(query, c))
    .sort(
      (a, b) =>
        STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
        Math.round((b.rawScore - a.rawScore) * 50) ||
        EXPLICIT_RANK[a.candidate.explicit] - EXPLICIT_RANK[b.candidate.explicit] ||
        (Number(a.candidate.availability !== 'full') - Number(b.candidate.availability !== 'full')) ||
        (b.candidate.durationSec ?? 0) - (a.candidate.durationSec ?? 0),
    );
}
