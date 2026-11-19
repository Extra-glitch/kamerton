// Порядок результатов единого поиска. Оригинал от самого исполнителя из каталога выше,
// чем перезаливы, каверы и ремиксы с площадок, где музыку загружает кто угодно.

import { relevance, RELEVANT } from '@/core/relevance';
import { normalizeText, primaryArtist, similarity, splitArtists } from '@/core/text';
import type { TrackView, VersionTag } from '@/core/types';
import { parseTitle } from '@/core/versions';
import { playMode } from '@/sources/registry';

/** Источники, где песни публикуют сами исполнители и лейблы. */
const TRUSTED = new Set(['deezer', 'itunes', 'spotify', 'local', 'subsonic']);
const DERIVED: VersionTag[] = ['remix', 'cover', 'karaoke', 'sped_up', 'slowed', 'nightcore', 'instrumental'];
const SOFT: VersionTag[] = ['live', 'acoustic', 'demo'];

export function searchScore(variants: string[], t: TrackView): number {
  const artists = [primaryArtist(t.artist), ...splitArtists(t.artist)];
  const artistHit = variants.some((v) => artists.some((a) => similarity(v, a) >= 0.9));
  const core = parseTitle(t.title).coreTitle || t.title;
  const titleHit = variants.some((v) => similarity(v, core) >= 0.92);
  const r = Math.max(0, ...variants.map((v) => relevance(v, t)));
  const comboHit = r >= 0.97;
  const trusted = t.sources.some((s) => TRUSTED.has(s.source) || (s.source === 'youtube' && (s.extra as { topic?: boolean } | undefined)?.topic));
  // Чужой пользователь загрузил «Исполнитель - Песня» под своим именем.
  const reupload = !artistHit && !trusted && variants.some((v) => normalizeText(t.title).includes(normalizeText(v)));
  const tags = parseTitle(t.title).versionTags.concat(t.versionTags ?? []);
  const penalty = tags.some((x) => DERIVED.includes(x)) ? 15 : tags.some((x) => SOFT.includes(x)) ? 5 : 0;
  const mode = t.preferred ? playMode(t.preferred) : 'none';
  const base = artistHit ? 50 : comboHit ? 45 : titleHit ? 40 : r >= 0.95 ? 25 : r >= RELEVANT ? 15 : 0;
  return base + (trusted ? 12 : 0) - penalty - (reupload ? 20 : 0) + (mode === 'player' || mode === 'embed' ? 4 : mode === 'preview' ? 1 : 0)
    + Math.min(2, new Set(t.sources.map((s) => s.source)).size - 1);
}
