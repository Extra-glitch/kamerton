// Трек из аудиофайла: название и исполнитель из тегов, иначе из имени файла.
// Отдельно от platform/localMusic, чтобы проверять без телефона.

import type { AudioTags } from '@/core/audioTags';
import { md5 } from '@/core/md5';
import type { RemoteTrack } from '@/core/types';
import { cleanImportedName, isOpaqueName, parseFileName } from './fileNames';

export type TitleFrom = 'tags' | 'file' | 'none' | 'user';
export const UNKNOWN_TITLE = 'Без названия';
export const UNKNOWN_ARTIST = 'Неизвестный исполнитель';

export function trackFromFile(name: string, uri: string, durationSec: number | undefined, tags: AudioTags | null, origin?: { from: string; at: number }): RemoteTrack {
  // Имя вида «2_5341234123412341234.mp3» (так Telegram отдаёт файлы) ничего не говорит о песне.
  const fromName = isOpaqueName(name) ? { title: '', artist: undefined } : parseFileName(name);
  const id = md5(uri);
  // Теги важнее имени файла, но в них тоже бывают имена ботов и адреса сайтов.
  const tagTitle = cleanImportedName(tags?.title);
  const tagArtist = cleanImportedName(tags?.artist);
  const titleFrom: TitleFrom = tagTitle ? 'tags' : fromName.title ? 'file' : 'none';
  return {
    source: 'local', sourceTrackId: id, title: tagTitle || fromName.title || UNKNOWN_TITLE, artist: tagArtist || fromName.artist || UNKNOWN_ARTIST,
    album: tags?.album || undefined, trackNumber: tags?.trackNumber, durationSec: tags?.durationSec ?? durationSec, isrc: tags?.isrc || undefined, mbid: tags?.mbid || undefined,
    explicit: tags?.explicit ?? 'unknown', tags: tags?.genre ?? [], bpm: tags?.bpm, year: tags?.year, availability: 'full', quality: tags?.quality, canOffline: true,
    extra: { uri, fileName: name, lyrics: tags?.lyrics, importedFrom: origin?.from, importedAt: origin?.at, titleFrom, needsInfo: titleFrom === 'none' },
  };
}

