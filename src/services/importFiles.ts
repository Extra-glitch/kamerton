// Импорт аудиофайлов: «Поделиться» из Telegram и других приложений, выбор файла и новая
// музыка в памяти телефона. Обложку, если её нет в самом файле, берём из каталога Deezer:
// его API разрешает показывать обложки альбомов с указанием источника.
//
// Telegram при «Поделиться» передаёт только сам файл из своего кэша с именем вида
// «2_5341234123412341234.mp3». Название, исполнитель и обложка, которые видны в чате, хранятся
// в сообщении Telegram и вместе с файлом не приходят. Если в самом файле нет тегов, узнать песню
// не из чего: приложение честно говорит об этом и предлагает найти её в каталоге.

import { similarity, primaryArtist } from '@/core/text';
import type { RemoteTrack } from '@/core/types';
import { parseTitle } from '@/core/versions';
import * as repo from '@/db/repo';
import { importAudioFiles, scanNewFiles, type ImportedFile, type ImportResult, type IncomingFile } from '@/platform/localMusic';
import { sourceContext as ctx } from '@/platform/secureConfig';
import { queryVariants } from '@/search/variants';
import { adapter, isDisabled } from '@/sources/registry';

/** Обложка той же песни из каталога. Только при уверенном совпадении названия и исполнителя. */
export async function coverFromCatalog(t: Pick<RemoteTrack, 'title' | 'artist'>): Promise<string | undefined> {
  const dz = adapter('deezer');
  if (!dz?.searchTracks || !t.artist || t.artist === 'Неизвестный исполнитель') return undefined;
  const title = parseTitle(t.title).coreTitle;
  const found = await dz.searchTracks(ctx, `${primaryArtist(t.artist)} ${title}`, 5);
  const hit = found.find((c) => similarity(parseTitle(c.title).coreTitle, title) >= 0.9 && similarity(primaryArtist(c.artist), primaryArtist(t.artist)) >= 0.88);
  return hit?.coverUrl;
}

// ---------- Журнал импорта: что пришло и что из этого получилось ----------

export interface ImportLogEntry {
  at: number; from: string; name: string; size: number;
  result: 'added' | 'repeat' | 'skipped';
  title?: string; artist?: string; titleFrom?: string; coverFrom?: string; needsInfo?: boolean; reason?: string; trackId?: string;
}
const LOG = 'import.log';

export async function importLog(): Promise<ImportLogEntry[]> { return repo.kvGet<ImportLogEntry[]>(LOG, []); }

async function writeLog(from: string, files: ImportedFile[], skipped: ImportResult['skipped']) {
  const at = Date.now();
  const entries: ImportLogEntry[] = [
    ...files.map((f) => ({ at, from, name: f.name, size: f.size, result: f.known ? 'repeat' as const : 'added' as const, title: f.title, artist: f.artist, titleFrom: f.titleFrom, coverFrom: f.coverFrom, needsInfo: f.needsInfo, trackId: f.trackId })),
    ...skipped.map((s) => ({ at, from, name: s.name, size: 0, result: 'skipped' as const, reason: s.reason })),
  ];
  if (!entries.length) return;
  await repo.kvSet(LOG, [...entries, ...(await importLog())].slice(0, 30));
}

export async function importShared(files: IncomingFile[]): Promise<ImportResult> {
  if (isDisabled('local')) throw new Error('Источник «На телефоне» выключен в Диагностике источников. Включите его, чтобы слушать присланные песни.');
  const r = await importAudioFiles(files, 'Поделиться', coverFromCatalog);
  await writeLog('Поделиться', r.files, r.skipped);
  return r;
}

const SINCE = 'autoImport.since';

/** Новые песни в памяти телефона с прошлого раза. При первом запуске только запоминает момент. */
export async function importNewDeviceFiles(): Promise<string[]> {
  if (isDisabled('local')) return [];
  const since = await repo.kvGet<number | null>(SINCE, null);
  const now = Date.now();
  if (!since) { await repo.kvSet(SINCE, now); return []; }
  const files = await scanNewFiles(since - 60_000, coverFromCatalog);
  await repo.kvSet(SINCE, now);
  await writeLog('память телефона', files, []);
  return files.map((f) => f.trackId);
}

// ---------- «Что это за песня?» для файлов без названия ----------

export interface Candidate { track: RemoteTrack; durationMatch: boolean }

/** Варианты из каталогов (Deezer, Apple), совпадающие по длительности — первыми. */
export async function identifyCandidates(q: string, durationSec?: number): Promise<Candidate[]> {
  const sources = ['deezer', 'itunes'].map((id) => adapter(id)).filter((a) => !!a?.search);
  // «Zemfira Iskala» ищется и как «земфира искала»: на телефоне часто включена английская раскладка.
  const variants = queryVariants(q).slice(0, 2);
  const lists = await Promise.all(sources.flatMap((a) => variants.map((v) => a!.search!(ctx, v, 15).then((r) => r.tracks).catch(() => [] as RemoteTrack[]))));
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const t of lists.flat()) {
    const key = `${primaryArtist(t.artist).toLowerCase()}|${parseTitle(t.title).coreTitle}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ track: t, durationMatch: !!durationSec && !!t.durationSec && Math.abs(t.durationSec - durationSec) <= 3 });
  }
  return out.sort((a, b) => Number(b.durationMatch) - Number(a.durationMatch));
}

/** Подставляет название, исполнителя, альбом и обложку выбранной песни. */
export async function applyIdentity(trackId: string, v: { title: string; artist: string; album?: string; coverUrl?: string; isrc?: string }) {
  await repo.retagTrack(trackId, { title: v.title.trim(), artist: v.artist.trim() || 'Неизвестный исполнитель', album: v.album ?? null, coverUrl: v.coverUrl, isrc: v.isrc, titleFrom: 'user', coverFrom: v.coverUrl ? 'catalog' : undefined });
}
