import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, FileMode, Paths } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library/legacy';
import { Platform } from 'react-native';
import { readAudioTags, type AudioTags } from '@/core/audioTags';
import { parseLyrics } from '@/core/lrc';
import { md5 } from '@/core/md5';
import { normalizeText } from '@/core/text';
import { cleanImportedName, isAudioFile, parseFileName } from '@/import/fileNames';
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

async function saveCover(id: string, pic: NonNullable<AudioTags['picture']>): Promise<string | undefined> {
  try {
    const dir = new Directory(Paths.document, 'covers');
    if (!dir.exists) dir.create({ intermediates: true });
    const file = new File(dir, `${id}.${pic.mime.includes('png') ? 'png' : 'jpg'}`);
    if (!file.exists) { file.create(); await file.write(pic.data); }
    return file.uri;
  } catch { return undefined; }
}

export function trackFromFile(name: string, uri: string, durationSec: number | undefined, tags: AudioTags | null, origin?: { from: string; at: number }): RemoteTrack {
  const fromName = parseFileName(name);
  const id = md5(uri);
  // Теги важнее имени файла, но в них тоже бывают имена ботов и адреса сайтов.
  const title = cleanImportedName(tags?.title) || fromName.title;
  const artist = cleanImportedName(tags?.artist) || fromName.artist || 'Неизвестный исполнитель';
  return {
    source: 'local', sourceTrackId: id, title, artist,
    album: tags?.album || undefined, trackNumber: tags?.trackNumber, durationSec: tags?.durationSec ?? durationSec, isrc: tags?.isrc || undefined, mbid: tags?.mbid || undefined,
    explicit: tags?.explicit ?? 'unknown', tags: tags?.genre ?? [], bpm: tags?.bpm, year: tags?.year, availability: 'full', quality: tags?.quality, canOffline: true,
    extra: { uri, fileName: name, lyrics: tags?.lyrics, importedFrom: origin?.from, importedAt: origin?.at },
  };
}

async function addFile(name: string, uri: string, duration?: number, origin?: { from: string; at: number }, cover?: (t: RemoteTrack) => Promise<string | undefined>) {
  const tags = await tagsOf(uri);
  const t = trackFromFile(name, uri, duration, tags, origin);
  if (tags?.picture) t.coverUrl = await saveCover(t.sourceTrackId, tags.picture);
  if (!t.coverUrl && cover) t.coverUrl = await cover(t).catch(() => undefined);
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

export interface IncomingFile { uri: string; name: string; mime?: string | null }
export interface ImportResult { trackIds: string[]; skipped: string[] }

/**
 * Файлы, присланные через «Поделиться» (например, из Telegram) или выбранные вручную.
 * Копия кладётся в папку приложения: ссылка от другого приложения со временем перестаёт работать.
 */
export async function importAudioFiles(files: IncomingFile[], from: string, cover?: (t: RemoteTrack) => Promise<string | undefined>): Promise<ImportResult> {
  const dir = new Directory(Paths.document, 'music');
  if (!dir.exists) dir.create({ intermediates: true });
  const out: ImportResult = { trackIds: [], skipped: [] };
  const at = Date.now();
  for (const f of files) {
    if (!isAudioFile(f.mime, f.name)) { out.skipped.push(f.name); continue; }
    try {
      const safe = f.name.replace(/[\\/:*?"<>|]+/g, '_').slice(-120) || `audio-${at}.mp3`;
      let target = new File(dir, safe);
      const src = new File(f.uri);
      if (target.exists && target.size !== src.size) target = new File(dir, `${at}-${safe}`);
      if (!target.exists) await src.copy(target); // копирование асинхронное: теги читаем только после него
      out.trackIds.push(await addFile(f.name, target.uri, undefined, { from, at }, cover));
    } catch (e) {
      console.warn('Файл не добавлен:', f.name, (e as Error).message);
      out.skipped.push(f.name);
    }
  }
  return out;
}

/** Новая музыка в памяти телефона с прошлой проверки: например, песни, сохранённые из Telegram в «Музыку» или «Загрузки». */
export async function scanNewFiles(sinceMs: number, cover?: (t: RemoteTrack) => Promise<string | undefined>): Promise<string[]> {
  if (Platform.OS === 'web') return [];
  const perm = await MediaLibrary.getPermissionsAsync(false, ['audio']);
  if (!perm.granted) return [];
  const ids: string[] = [];
  let after: string | undefined;
  for (let pageNo = 0; pageNo < 10; pageNo++) {
    const page = await MediaLibrary.getAssetsAsync({ mediaType: MediaLibrary.MediaType.audio, first: 100, after, createdAfter: sinceMs, sortBy: [[MediaLibrary.SortBy.creationTime, false]] });
    for (const a of page.assets) {
      // Голосовые сообщения и записи разговоров — не музыка.
      if ((a.duration && a.duration < 45) || /^(ptt|aud|voice|recording|call|запись|голос)/i.test(a.filename) || /\.(amr|3gp|3ga)$/i.test(a.filename)) continue;
      ids.push(await addFile(a.filename, a.uri, a.duration || undefined, { from: 'память телефона', at: Date.now() }, cover));
    }
    if (!page.hasNextPage) break;
    after = page.endCursor;
  }
  return ids;
}

/** Добавление выбранных файлов: копия хранится в папке приложения, чтобы доступ не пропал. */
export async function pickAudioFiles(): Promise<number> {
  const res = await DocumentPicker.getDocumentAsync({ type: 'audio/*', multiple: true, copyToCacheDirectory: true });
  if (res.canceled) return 0;
  const dir = new Directory(Paths.document, 'music');
  if (!dir.exists) dir.create({ intermediates: true });
  for (const a of res.assets) {
    const target = new File(dir, a.name);
    if (!target.exists) await new File(a.uri).copy(target);
    await addFile(a.name, target.uri, undefined, { from: 'выбор файла', at: Date.now() });
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
  await new File(a.uri).copy(target);
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

export async function writeExportFile(name: string, text: string): Promise<string> {
  const f = new File(Paths.cache, name);
  if (f.exists) f.delete();
  f.create();
  await f.write(text);
  return f.uri;
}
