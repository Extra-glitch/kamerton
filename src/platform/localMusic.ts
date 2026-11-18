import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, FileMode, Paths } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library/legacy';
import { Platform } from 'react-native';
import { readAudioTags, type AudioTags } from '@/core/audioTags';
import { parseLyrics } from '@/core/lrc';
import { md5 } from '@/core/md5';
import { normalizeText } from '@/core/text';
import type { RemoteTrack } from '@/core/types';
import { cacheLyrics, rawDb, upsertRemote } from '@/db/repo';

async function tagsOf(uri: string): Promise<AudioTags | null> {
  let handle: ReturnType<File['open']> | null = null;
  try {
    const f = new File(uri);
    handle = f.open(FileMode.ReadOnly); // доступ к общей папке только на чтение
    const h = handle;
    const size = f.size ?? h.size ?? 0;
    if (!size) return null;
    return await readAudioTags(async (offset, length) => { h.offset = offset; return h.readBytes(length); }, size);
  } catch (e) {
    console.warn('Теги файла не прочитаны:', (e as Error).message);
    return null;
  } finally {
    try { handle?.close(); } catch { /* файл уже закрыт */ }
  }
}

function saveCover(id: string, pic: NonNullable<AudioTags['picture']>): string | undefined {
  try {
    const dir = new Directory(Paths.document, 'covers');
    if (!dir.exists) dir.create({ intermediates: true });
    const file = new File(dir, `${id}.${pic.mime.includes('png') ? 'png' : 'jpg'}`);
    if (!file.exists) { file.create(); file.write(pic.data); }
    return file.uri;
  } catch { return undefined; }
}

export function trackFromFile(name: string, uri: string, durationSec: number | undefined, tags: AudioTags | null): RemoteTrack {
  const base = name.replace(/\.[^.]+$/, '');
  const dash = base.match(/^(?:\d+[\s.-]+)?(.+?)\s+[-–—]\s+(.+)$/);
  const id = md5(uri);
  const cover = tags?.picture ? saveCover(id, tags.picture) : undefined;
  return {
    source: 'local', sourceTrackId: id, title: tags?.title?.trim() || dash?.[2] || base, artist: tags?.artist?.trim() || dash?.[1] || 'Неизвестный исполнитель',
    album: tags?.album || undefined, trackNumber: tags?.trackNumber, durationSec: tags?.durationSec ?? durationSec, isrc: tags?.isrc || undefined, mbid: tags?.mbid || undefined,
    explicit: tags?.explicit ?? 'unknown', tags: tags?.genre ?? [], bpm: tags?.bpm, year: tags?.year, coverUrl: cover, availability: 'full', quality: tags?.quality, canOffline: true,
    extra: { uri, fileName: name, lyrics: tags?.lyrics },
  };
}

async function addFile(name: string, uri: string, duration?: number) {
  const tags = await tagsOf(uri);
  const t = trackFromFile(name, uri, duration, tags);
  const trackId = await upsertRemote(t, { library: true, pool: true, localPath: uri });
  if (tags?.lyrics) {
    const parsed = parseLyrics(tags.lyrics, 'теги файла');
    if (parsed) await cacheLyrics(trackId, parsed);
  }
  return trackId;
}

export interface ScanProgress { done: number; total: number }

/** Находит аудио на устройстве через системную медиатеку. */
export async function scanDevice(onProgress?: (p: ScanProgress) => void): Promise<number> {
  if (Platform.OS === 'web') throw new Error('Поиск файлов работает только на телефоне.');
  const perm = await MediaLibrary.requestPermissionsAsync(false, ['audio']);
  if (!perm.granted) throw new Error('Нет доступа к аудио. Разрешите его в настройках Android.');
  let after: string | undefined;
  let done = 0;
  for (;;) {
    const page = await MediaLibrary.getAssetsAsync({ mediaType: MediaLibrary.MediaType.audio, first: 100, after });
    for (const a of page.assets) {
      await addFile(a.filename, a.uri, a.duration || undefined);
      onProgress?.({ done: ++done, total: page.totalCount });
    }
    if (!page.hasNextPage) return done;
    after = page.endCursor;
  }
}

/** Добавление выбранных файлов: копия хранится в папке приложения, чтобы доступ не пропал. */
export async function pickAudioFiles(): Promise<number> {
  const res = await DocumentPicker.getDocumentAsync({ type: 'audio/*', multiple: true, copyToCacheDirectory: true });
  if (res.canceled) return 0;
  const dir = new Directory(Paths.document, 'music');
  if (!dir.exists) dir.create({ intermediates: true });
  for (const a of res.assets) {
    const target = new File(dir, a.name);
    if (!target.exists) new File(a.uri).copy(target);
    await addFile(a.name, target.uri);
  }
  return res.assets.length;
}

export async function searchLocal(q: string, limit: number): Promise<RemoteTrack[]> {
  const rows = await rawDb().all<{ data: string }>(
    `SELECT s.data FROM source_tracks s JOIN tracks t ON t.id = s.track_id WHERE s.source = 'local' AND t.search_text LIKE ? LIMIT ?`,
    [`%${normalizeText(q)}%`, limit]);
  return rows.map((r) => JSON.parse(r.data));
}

export async function readLocalLyrics(t: RemoteTrack): Promise<string | null> {
  return (t.extra?.lyrics as string | undefined) ?? null;
}

/** Текстовый файл, выбранный пользователем: плейлист, .lrc или карточка вкуса. */
export async function pickTextFile(types: string[] = ['*/*']): Promise<{ name: string; text: string } | null> {
  const res = await DocumentPicker.getDocumentAsync({ type: types, copyToCacheDirectory: true });
  if (res.canceled) return null;
  const a = res.assets[0];
  if (Platform.OS === 'web') return { name: a.name, text: await (await fetch(a.uri)).text() };
  return { name: a.name, text: await new File(a.uri).text() };
}

export async function pickImage(): Promise<string | null> {
  const res = await DocumentPicker.getDocumentAsync({ type: 'image/*', copyToCacheDirectory: true });
  if (res.canceled) return null;
  const a = res.assets[0];
  if (Platform.OS === 'web') return a.uri;
  const dir = new Directory(Paths.document, 'covers');
  if (!dir.exists) dir.create({ intermediates: true });
  const target = new File(dir, `pl-${Date.now()}-${a.name}`);
  new File(a.uri).copy(target);
  return target.uri;
}

/** Скачивание только для источников, где это разрешено. */
export async function downloadToApp(url: string, name: string): Promise<{ uri: string; size: number }> {
  const dir = new Directory(Paths.document, 'offline');
  if (!dir.exists) dir.create({ intermediates: true });
  const target = new File(dir, name);
  if (target.exists) target.delete();
  const f = await File.downloadFileAsync(url, target);
  return { uri: f.uri, size: f.size ?? 0 };
}

export function deleteFile(uri: string) { try { const f = new File(uri); if (f.exists) f.delete(); } catch { /* файла уже нет */ } }

export function writeExportFile(name: string, text: string): string {
  const f = new File(Paths.cache, name);
  if (f.exists) f.delete();
  f.create();
  f.write(text);
  return f.uri;
}
