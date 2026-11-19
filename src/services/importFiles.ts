// Импорт аудиофайлов: «Поделиться» из Telegram и других приложений, выбор файла и новая
// музыка в памяти телефона. Обложку, если её нет в самом файле, берём из каталога Deezer:
// его API разрешает показывать обложки альбомов с указанием источника.

import { similarity, primaryArtist } from '@/core/text';
import type { RemoteTrack } from '@/core/types';
import { parseTitle } from '@/core/versions';
import * as repo from '@/db/repo';
import { importAudioFiles, scanNewFiles, type ImportResult, type IncomingFile } from '@/platform/localMusic';
import { sourceContext as ctx } from '@/platform/secureConfig';
import { deezer } from '@/sources/deezer';
import { isDisabled } from '@/sources/registry';

/** Обложка той же песни из каталога. Только при уверенном совпадении названия и исполнителя. */
export async function coverFromCatalog(t: Pick<RemoteTrack, 'title' | 'artist'>): Promise<string | undefined> {
  if (isDisabled('deezer') || !t.artist || t.artist === 'Неизвестный исполнитель') return undefined;
  const title = parseTitle(t.title).coreTitle;
  const found = await deezer.searchTracks!(ctx, `${primaryArtist(t.artist)} ${title}`, 5);
  const hit = found.find((c) => similarity(parseTitle(c.title).coreTitle, title) >= 0.9 && similarity(primaryArtist(c.artist), primaryArtist(t.artist)) >= 0.88);
  return hit?.coverUrl;
}

export function importShared(files: IncomingFile[]): Promise<ImportResult> {
  return importAudioFiles(files, 'Поделиться', coverFromCatalog);
}

const SINCE = 'autoImport.since';

/** Новые песни в памяти телефона с прошлого раза. При первом запуске только запоминает момент. */
export async function importNewDeviceFiles(): Promise<string[]> {
  if (isDisabled('local')) return [];
  const since = await repo.kvGet<number | null>(SINCE, null);
  const now = Date.now();
  if (!since) { await repo.kvSet(SINCE, now); return []; }
  const ids = await scanNewFiles(since - 60_000, coverFromCatalog);
  await repo.kvSet(SINCE, now);
  return ids;
}
