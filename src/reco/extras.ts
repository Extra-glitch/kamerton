// Умный DJ, музыкальный портрет, общие лайки и умная очистка. Только чистая логика.

import { effectiveExplicit } from '@/core/choose';
import { normalizeText, primaryArtist } from '@/core/text';
import type { PlayRecord, PlaylistItem, TrackView } from '@/core/types';
import { canonicalKey } from '@/core/versions';
import { artistKey, featuresOf, scoreTrack, type Profile } from './engine';

// ---------- Умный DJ ----------

export type DjMode = 'smooth' | 'rise' | 'contrast';
export interface DjStep { track: TrackView; note: string }

function closeness(a: TrackView, b: TrackView): { value: number; common: string[] } {
  const fa = featuresOf(a);
  const fb = featuresOf(b);
  let value = 0;
  const common: string[] = [];
  for (const [f, w] of fa) {
    if (!fb.has(f) || f.startsWith('a:')) continue;
    value += w;
    if (f.startsWith('t:')) common.push(f.slice(2));
  }
  if (a.bpm && b.bpm) value += Math.max(0, 1 - Math.abs(a.bpm - b.bpm) / 24);
  if (a.year && b.year) value += Math.max(0, 0.3 - Math.abs(a.year - b.year) / 60);
  if (artistKey(a.artist) === artistKey(b.artist)) value -= 0.8; // два трека одного исполнителя подряд скучнее
  return { value, common };
}

export const energyOf = (t: TrackView) => t.bpm ?? 100;

/** Выстраивает очередь так, чтобы переходы были осмысленными, и объясняет каждый. */
export function djSequence(tracks: TrackView[], mode: DjMode = 'smooth'): DjStep[] {
  if (!tracks.length) return [];
  const left = [...tracks];
  if (mode === 'rise') left.sort((a, b) => energyOf(a) - energyOf(b));
  const out: DjStep[] = [{ track: left.shift()!, note: mode === 'rise' ? 'Начинаем спокойно' : 'Открываем набор' }];
  while (left.length) {
    const cur = out[out.length - 1].track;
    let best = 0;
    let bestValue = -Infinity;
    left.forEach((t, i) => {
      const c = closeness(cur, t).value;
      const v = mode === 'contrast' ? -c : mode === 'rise' ? c - Math.max(0, energyOf(t) - energyOf(cur) - 12) * 0.1 - Math.max(0, energyOf(cur) - energyOf(t)) * 0.2 : c;
      if (v > bestValue) { bestValue = v; best = i; }
    });
    const next = left.splice(best, 1)[0];
    const { common } = closeness(cur, next);
    let note: string;
    if (mode === 'contrast') note = common.length ? `Резкий поворот, общая только тема ${common[0]}` : 'Резкая смена настроения';
    else if (common.length) note = `Связка через ${common[0]}`;
    else if (cur.bpm && next.bpm && Math.abs(cur.bpm - next.bpm) <= 6) note = `Держим темп около ${Math.round(next.bpm)} уд/мин`;
    else if (mode === 'rise' && cur.bpm && next.bpm && next.bpm > cur.bpm) note = `Разгоняемся до ${Math.round(next.bpm)} уд/мин`;
    else note = 'Общих признаков мало, смена темы';
    out.push({ track: next, note });
  }
  return out;
}

// ---------- Музыкальный портрет ----------

export interface Portrait {
  hours: number; plays: number; tracks: number; artists: number; discoveries: number; completion: number;
  topArtists: { name: string; minutes: number; share: number }[];
  topTags: { name: string; minutes: number; share: number }[];
  decades: { decade: number; minutes: number; share: number }[];
  byHour: number[];
  noveltyShare: number;
}

export function buildPortrait(plays: PlayRecord[], tracks: Map<string, TrackView>, sinceMs = 0): Portrait {
  const artists = new Map<string, { name: string; minutes: number }>();
  const tags = new Map<string, number>();
  const decades = new Map<number, number>();
  const byHour = new Array<number>(24).fill(0);
  const firstSeen = new Map<string, number>();
  let ms = 0; let done = 0; let counted = 0;
  const sorted = [...plays].sort((a, b) => a.startedAt - b.startedAt);
  let discoveries = 0;
  const unique = new Set<string>();
  for (const p of sorted) {
    if (p.listenedMs < 5000) continue;
    const t = tracks.get(p.trackId);
    if (!t) continue;
    const a = artistKey(t.artist);
    const isFirst = !firstSeen.has(a);
    if (isFirst) firstSeen.set(a, p.startedAt);
    if (p.startedAt < sinceMs) continue;
    if (isFirst) discoveries++;
    counted++; ms += p.listenedMs; unique.add(p.trackId);
    if (p.completed) done++;
    const min = p.listenedMs / 60000;
    const e = artists.get(a) ?? { name: primaryArtist(t.artist), minutes: 0 };
    e.minutes += min;
    artists.set(a, e);
    for (const tag of t.tags.slice(0, 5)) tags.set(tag, (tags.get(tag) ?? 0) + min);
    if (t.year) { const d = Math.floor(t.year / 10) * 10; decades.set(d, (decades.get(d) ?? 0) + min); }
    byHour[new Date(p.startedAt).getHours()] += min;
  }
  const total = ms / 60000 || 1;
  const share = (m: number) => m / total;
  return {
    hours: ms / 3_600_000, plays: counted, tracks: unique.size, artists: artists.size, discoveries, completion: counted ? done / counted : 0,
    topArtists: [...artists.values()].sort((a, b) => b.minutes - a.minutes).slice(0, 8).map((a) => ({ ...a, share: share(a.minutes) })),
    topTags: [...tags].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([name, minutes]) => ({ name, minutes, share: share(minutes) })),
    decades: [...decades].sort((a, b) => a[0] - b[0]).map(([decade, minutes]) => ({ decade, minutes, share: share(minutes) })),
    byHour, noveltyShare: artists.size ? discoveries / artists.size : 0,
  };
}

// ---------- Общие лайки ----------

export interface TasteCard {
  format: 'kamerton-taste'; version: 1; name: string; createdAt: string;
  likes: { artist: string; title: string; isrc?: string }[];
  artists: string[]; tags: string[];
}

export function buildTasteCard(name: string, liked: TrackView[], profile: Profile): TasteCard {
  const top = (prefix: string, n: number) => [...profile.weights].filter(([k, v]) => k.startsWith(prefix) && v > 0).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k.slice(2));
  return {
    format: 'kamerton-taste', version: 1, name, createdAt: new Date().toISOString(),
    likes: liked.slice(0, 500).map((t) => ({ artist: t.artist, title: t.title, isrc: t.isrc })), artists: top('a:', 40), tags: top('t:', 40),
  };
}

export function parseTasteCard(text: string): TasteCard {
  let c: any;
  try { c = JSON.parse(text); } catch { throw new Error('Это не карточка вкуса: файл не читается как JSON.'); }
  if (c?.format !== 'kamerton-taste' || c.version !== 1 || !Array.isArray(c.likes)) throw new Error('Это не карточка вкуса Камертона.');
  return { ...c, name: String(c.name ?? 'Друг').slice(0, 60), artists: c.artists ?? [], tags: c.tags ?? [] };
}

export interface SharedTaste { common: TrackView[]; commonArtists: string[]; commonTags: string[]; forBoth: { track: TrackView; score: number }[]; match: number }

export function compareTaste(card: TasteCard, mine: TrackView[], pool: TrackView[], profile: Profile): SharedTaste {
  const keys = new Set(card.likes.map((l) => canonicalKey({ title: l.title, artist: l.artist, explicit: 'unknown' })));
  const isrcs = new Set(card.likes.map((l) => l.isrc).filter(Boolean));
  const common = mine.filter((t) => keys.has(t.canonicalKey) || (t.isrc && isrcs.has(t.isrc)));
  const myArtists = new Set([...profile.weights].filter(([k, v]) => k.startsWith('a:') && v > 0).map(([k]) => k.slice(2)));
  const myTags = new Set([...profile.weights].filter(([k, v]) => k.startsWith('t:') && v > 0).map(([k]) => k.slice(2)));
  const theirArtists = new Set(card.artists.map(normalizeText));
  const theirTags = new Set(card.tags.map(normalizeText));
  const commonArtists = [...theirArtists].filter((a) => myArtists.has(a));
  const commonTags = [...theirTags].filter((t) => myTags.has(t));
  const forBoth = pool
    .filter((t) => t.preferred?.availability === 'full' && !t.preferred.isLive && !profile.playedTracks.has(t.id))
    .map((track) => {
      const theirs = (theirArtists.has(artistKey(track.artist)) ? 1 : 0) + track.tags.filter((x) => theirTags.has(normalizeText(x))).length * 0.5;
      const own = scoreTrack(track, profile);
      return { track, theirs, score: Math.min(theirs, own + 0.5) };
    })
    .filter((x) => x.theirs > 0 && x.score > 0)
    .sort((a, b) => b.score - a.score).slice(0, 30)
    .map(({ track, score }) => ({ track, score }));
  const union = new Set([...theirArtists, ...myArtists]).size + new Set([...theirTags, ...myTags]).size;
  return { common, commonArtists, commonTags, forBoth, match: union ? (commonArtists.length + commonTags.length) / union : 0 };
}

// ---------- Умная очистка ----------

export interface CleanupReport {
  duplicatesInPlaylist: { playlistId: string; items: PlaylistItem[] }[];
  sameSongManySources: TrackView[];
  missing: PlaylistItem[];
  unavailable: { track: TrackView; item?: PlaylistItem }[];
  cleanVersions: TrackView[];
  unknownVersion: number;
}

export function analyzeLibrary(items: PlaylistItem[], tracks: Map<string, TrackView>): CleanupReport {
  const byPlaylist = new Map<string, PlaylistItem[]>();
  for (const it of items) byPlaylist.set(it.playlistId, [...(byPlaylist.get(it.playlistId) ?? []), it]);
  const duplicatesInPlaylist: CleanupReport['duplicatesInPlaylist'] = [];
  for (const [playlistId, list] of byPlaylist) {
    const seen = new Map<string, PlaylistItem[]>();
    for (const it of list) {
      const t = it.trackId ? tracks.get(it.trackId) : undefined;
      const k = t?.canonicalKey ?? canonicalKey({ title: it.rawTitle, artist: it.rawArtist, explicit: 'unknown' });
      seen.set(k, [...(seen.get(k) ?? []), it]);
    }
    for (const group of seen.values()) if (group.length > 1) duplicatesInPlaylist.push({ playlistId, items: group });
  }
  const all = [...tracks.values()];
  const inUse = (t: TrackView) => t.sources.filter((s) => s.availability !== 'gone');
  return {
    duplicatesInPlaylist,
    sameSongManySources: all.filter((t) => new Set(inUse(t).map((s) => s.source)).size > 1),
    missing: items.filter((i) => i.status === 'missing' || !i.trackId),
    unavailable: all.filter((t) => t.sources.length > 0 && t.sources.every((s) => s.availability === 'gone')).map((track) => ({ track, item: items.find((i) => i.trackId === track.id) })),
    cleanVersions: all.filter((t) => t.preferred && effectiveExplicit(t.preferred) === 'clean'),
    unknownVersion: all.filter((t) => t.preferred && effectiveExplicit(t.preferred) === 'unknown').length,
  };
}

// ---------- Умные плейлисты ----------

export type SmartRule = { kind: 'tag' | 'mood' | 'decade' | 'tempo' | 'unplayed' | 'most_played' | 'liked_recent'; value?: string };

export function applySmartRule(rule: SmartRule, tracks: TrackView[], profile: Profile): TrackView[] {
  const v = normalizeText(rule.value ?? '');
  switch (rule.kind) {
    case 'tag': return tracks.filter((t) => t.tags.some((x) => normalizeText(x) === v));
    case 'mood': return tracks.filter((t) => t.mood && normalizeText(t.mood) === v);
    case 'decade': return tracks.filter((t) => t.year && Math.floor(t.year / 10) * 10 === Number(v));
    case 'tempo': return tracks.filter((t) => t.bpm && (v === 'fast' ? t.bpm >= 120 : v === 'slow' ? t.bpm < 90 : t.bpm >= 90 && t.bpm < 120));
    case 'unplayed': return tracks.filter((t) => !profile.playedTracks.has(t.id));
    case 'most_played': return tracks.filter((t) => profile.playedTracks.has(t.id)).sort((a, b) => profile.playedTracks.get(b.id)!.count - profile.playedTracks.get(a.id)!.count).slice(0, 50);
    default: return tracks.filter((t) => t.liked);
  }
}
