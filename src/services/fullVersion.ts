// Полная версия песни из каталога. Deezer и Apple дают сторонним приложениям только фрагменты,
// поэтому, если подключён YouTube, песня ищется там и играет целиком во встроенном плеере YouTube.
// Найденное видео привязывается к той же записи (те же исполнитель и название), и второй раз
// квота YouTube не тратится.

import { create } from 'zustand';
import { parseTitle } from '@/core/versions';
import { primaryArtist, similarity, splitArtists } from '@/core/text';
import type { RemoteTrack, TrackView } from '@/core/types';
import * as repo from '@/db/repo';
import { sourceContext as ctx } from '@/platform/secureConfig';
import { isDisabled } from '@/sources/registry';
import { searchYouTube, youtube } from '@/sources/youtube';

/** Подключён ли YouTube. Экраны подписываются на это, чтобы показывать «YouTube» вместо «фрагмент». */
export const useYouTubeReady = create<{ ready: boolean }>(() => ({ ready: false }));

export async function refreshYouTubeReady(): Promise<boolean> {
  const ready = !isDisabled('youtube') && (await youtube.status(ctx).catch(() => ({ state: 'error' }))).state === 'ready';
  useYouTubeReady.setState({ ready });
  return ready;
}

// Слова, которые выдают не оригинал. Если их нет в названии из каталога, такое видео не подходит.
// Границы слов задаются вручную: \b в JavaScript не понимает кириллицу.
const NOT_ORIGINAL = new RegExp(String.raw`(?<![a-zа-яё0-9])(cover|кавер|karaoke|караоке|минус|instrumental|инструментал|remix|ремикс|nightcore|slowed|sped up|speed up|8d|bass boosted|reverb|live|концерт|acoustic|акустик|reaction|реакция|tutorial|разбор|на гитаре|piano|пианино|parody|пародия|mashup|мэшап|lyric video|текст песни)(?![a-zа-яё0-9])`, 'i');

export interface Candidate { title: string; artist: string; durationSec?: number; channel?: string; topic?: boolean; availability?: string }

/**
 * Насколько видео похоже на эту песню: от 0 до 1. Ниже 0.6 видео не используется.
 * Учитываются название, исполнитель (в названии видео или в имени канала), длительность и признаки
 * официального канала («Исполнитель - Topic» на YouTube содержит саму студийную запись).
 */
export function scoreYouTubeMatch(t: { title: string; artist: string; durationSec?: number }, v: Candidate): number {
  if (v.availability === 'region_blocked') return 0;
  const base = parseTitle(t.title).coreTitle;
  const vBase = parseTitle(v.title).coreTitle;
  const titleSim = Math.max(similarity(base, vBase), similarity(t.title, v.title));
  if (titleSim < 0.75) return 0;
  const wanted = splitArtists(t.artist).map(primaryArtist);
  const hay = [v.artist, v.channel ?? '', ...splitArtists(v.artist)];
  const artistSim = Math.max(0, ...wanted.flatMap((a) => hay.map((h) => similarity(a, h))));
  if (artistSim < 0.8) return 0;
  const raw = `${v.title} ${v.channel ?? ''}`;
  if (NOT_ORIGINAL.test(raw) && !NOT_ORIGINAL.test(t.title)) return 0;
  let s = 0.45 * titleSim + 0.35 * artistSim;
  if (t.durationSec && v.durationSec) {
    const d = Math.abs(t.durationSec - v.durationSec);
    if (d > 60) return 0;
    s += d <= 6 ? 0.15 : d <= 15 ? 0.08 : 0;
  } else s += 0.04;
  if (v.topic) s += 0.08;
  else if (/official|официальн|vevo/i.test(raw)) s += 0.04;
  return Math.min(1, s);
}

const NONE = 'none';
const inflight = new Map<string, Promise<TrackView | null>>();

/** Находит полную версию песни на YouTube и привязывает её к записи. null — не нашлось или YouTube не подключён. */
export function findFullVersion(t: TrackView): Promise<TrackView | null> {
  if (t.sources.some((s) => s.source === 'youtube' && s.availability === 'full')) return Promise.resolve(t);
  const running = inflight.get(t.id);
  if (running) return running;
  const job = (async () => {
    if (!useYouTubeReady.getState().ready && !(await refreshYouTubeReady())) return null;
    const key = `full:youtube:${t.id}`;
    const cached = await repo.kvGet<string | null>(key, null);
    if (cached === NONE) return null;
    if (cached) {
      // Уже находили: берём запись, к которой привязано видео, без нового запроса к YouTube.
      const [known] = await repo.getViews([cached]);
      if (known?.sources.some((s) => s.source === 'youtube')) return known;
    }
    const q = `${primaryArtist(t.artist)} ${parseTitle(t.title).coreTitle}`;
    const { tracks } = await searchYouTube(ctx, q, 8, 0);
    const ranked = tracks
      .map((v) => ({ v, score: scoreYouTubeMatch(t, { title: v.title, artist: v.artist, durationSec: v.durationSec, channel: (v.extra as { channel?: string } | undefined)?.channel, topic: (v.extra as { topic?: boolean } | undefined)?.topic, availability: v.availability }) }))
      .filter((x) => x.score >= 0.6)
      .sort((a, b) => b.score - a.score);
    const best = ranked[0]?.v;
    if (!best) { await repo.kvSet(key, NONE); return null; }
    // Название и исполнитель берём из каталога: так запись сливается с той же песней, а не создаёт новую.
    const linked: RemoteTrack = {
      ...best, title: t.title, artist: t.artist, album: t.album, coverUrl: t.coverUrl ?? best.coverUrl,
      // Длительность из каталога: у клипа бывает вступление, а запись должна слиться с той же песней.
      explicit: t.explicit, isrc: undefined, durationSec: t.durationSec ?? best.durationSec,
    };
    // Если это видео уже попадалось в поиске, оно привязано к своей записи: тогда играет она.
    const id = await repo.upsertRemote(linked, { mlAllowed: false });
    await repo.kvSet(key, id);
    const [fresh] = await repo.getViews([id]);
    return fresh?.sources.some((s) => s.source === 'youtube') ? fresh : null;
  })().finally(() => inflight.delete(t.id));
  inflight.set(t.id, job);
  return job;
}
