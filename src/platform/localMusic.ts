import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, FileMode, Paths } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library/legacy';
import { Platform } from 'react-native';
import { readAudioTags, type AudioTags } from '@/core/audioTags';
import { parseLyrics } from '@/core/lrc';
import { normalizeText } from '@/core/text';
import { isAudioFile } from '@/import/fileNames';
import { trackFromFile, type TitleFrom } from '@/import/localTrack';
import type { RemoteTrack } from '@/core/types';
import { cacheLyrics, rawDb, retagTrack, sourceData, upsertRemote } from '@/db/repo';

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

export { trackFromFile, UNKNOWN_ARTIST, UNKNOWN_TITLE, type TitleFrom } from '@/import/localTrack';
const TITLE_RANK: Record<TitleFrom, number> = { none: 0, file: 1, tags: 2, user: 3 };

export interface AddedFile { trackId: string; title: string; artist: string; titleFrom: TitleFrom; coverFrom: 'file' | 'catalog' | 'none' | 'kept'; needsInfo: boolean; known: boolean }

async function addFile(name: string, uri: string, duration?: number, origin?: { from: string; at: number }, cover?: (t: RemoteTrack) => Promise<string | undefined>): Promise<AddedFile> {
  const tags = await tagsOf(uri);
  let t = trackFromFile(name, uri, duration, tags, origin);
  const prev = await sourceData(`local:${t.sourceTrackId}`);
  const prevFrom = (prev?.data.extra?.titleFrom as TitleFrom | undefined) ?? 'file';
  let coverFrom: AddedFile['coverFrom'] = 'none';
  if (tags?.picture) { t.coverUrl = await saveCover(t.sourceTrackId, tags.picture); if (t.coverUrl) coverFrom = 'file'; }
  // То, что пользователь указал сам, повторная отправка того же файла не затирает.
  if (prev && prevFrom === 'user') {
    t = { ...t, title: prev.data.title, artist: prev.data.artist, album: prev.data.album, coverUrl: t.coverUrl ?? prev.data.coverUrl, extra: { ...t.extra, titleFrom: 'user', needsInfo: false } };
    if (!t.coverUrl && prev.data.coverUrl) coverFrom = 'kept';
  }
  if (!t.coverUrl && cover && !t.extra?.needsInfo) { t.coverUrl = await cover(t).catch(() => undefined); if (t.coverUrl) coverFrom = 'catalog'; }
  if (!t.coverUrl && prev?.data.coverUrl) { t.coverUrl = prev.data.coverUrl; coverFrom = 'kept'; }
  const trackId = await upsertRemote(t, { library: true, pool: true, localPath: uri });
  const from = t.extra!.titleFrom as TitleFrom;
  // Файл уже был, но раньше его название взяли из имени (или его не было), а теперь прочитались теги.
  if (prev && (TITLE_RANK[from] > TITLE_RANK[prevFrom] || (!prev.data.coverUrl && t.coverUrl))) {
    await retagTrack(trackId, { title: t.title, artist: t.artist, album: t.album ?? null, coverUrl: t.coverUrl ?? null, titleFrom: from });
  }
  if (tags?.lyrics) {
    const parsed = parseLyrics(tags.lyrics, 'теги файла');
    if (parsed) await cacheLyrics(trackId, parsed);
  }
  return { trackId, title: t.title, artist: t.artist, titleFrom: from, coverFrom, needsInfo: !!t.extra?.needsInfo, known: !!prev };
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

export interface IncomingFile { uri: string; name: string; mime?: string | null; size?: number | null }
export interface ImportedFile extends AddedFile { name: string; size: number }
export interface ImportResult { trackIds: string[]; skipped: { name: string; reason: string }[]; files: ImportedFile[] }

const MIME_EXT: Record<string, string> = { 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/flac': 'flac', 'audio/x-flac': 'flac', 'audio/ogg': 'ogg', 'audio/opus': 'opus', 'audio/wav': 'wav', 'audio/x-wav': 'wav' };
const safeName = (name: string) => name.replace(/[\\/:*?"<>|#%]+/g, '_').slice(-120);

/**
 * Файлы, присланные через «Поделиться» (например, из Telegram) или выбранные вручную.
 * Копия кладётся в папку приложения: ссылка от другого приложения со временем перестаёт работать.
 * Имя копии — хеш содержимого, поэтому одна и та же песня, присланная дважды, не дублируется.
 */
export async function importAudioFiles(files: IncomingFile[], from: string, cover?: (t: RemoteTrack) => Promise<string | undefined>): Promise<ImportResult> {
  const dir = new Directory(Paths.document, 'music');
  if (!dir.exists) dir.create({ intermediates: true });
  const out: ImportResult = { trackIds: [], skipped: [], files: [] };
  const at = Date.now();
  for (const f of files) {
    if (!isAudioFile(f.mime, f.name)) { out.skipped.push({ name: f.name, reason: 'не аудиофайл' }); continue; }
    try {
      const src = new File(f.uri);
      if (!src.exists) throw new Error('файл недоступен: приложение-отправитель не дало к нему доступ');
      const size = src.size ?? 0;
      if (!size) throw new Error('пустой файл');
      const ext = (f.name.match(/\.([a-z0-9]{2,5})$/i)?.[1] ?? MIME_EXT[String(f.mime).toLowerCase()] ?? 'mp3').toLowerCase();
      let hash = '';
      try { hash = (await src.digest('MD5')).slice(0, 24); } catch { /* без хеша — по имени и времени */ }
      // Версия 0.4.0 клала копию под исходным именем: если такая есть и совпадает по размеру, берём её.
      const legacy = new File(dir, safeName(f.name));
      const target = legacy.exists && legacy.size === size ? legacy : new File(dir, hash ? `${hash}.${ext}` : `${at}-${safeName(f.name) || `audio.${ext}`}`);
      if (!target.exists) await src.copy(target); // копирование асинхронное: теги читаем только после него
      if (target.size !== size) { try { target.delete(); } catch { /* ничего */ } throw new Error('файл скопировался не полностью'); }
      const added = await addFile(f.name, target.uri, undefined, { from, at }, cover);
      out.trackIds.push(added.trackId);
      out.files.push({ ...added, name: f.name, size });
      // Временную копию, которую сделал приём «Поделиться», больше не храним.
      if (src.uri.startsWith(Paths.cache.uri)) { try { src.delete(); } catch { /* не страшно */ } }
    } catch (e) {
      console.warn('Файл не добавлен:', f.name, (e as Error).message);
      out.skipped.push({ name: f.name, reason: (e as Error).message });
    }
  }
  return out;
}

/** Новая музыка в памяти телефона с прошлой проверки: например, песни, сохранённые из Telegram в «Музыку» или «Загрузки». */
export async function scanNewFiles(sinceMs: number, cover?: (t: RemoteTrack) => Promise<string | undefined>): Promise<ImportedFile[]> {
  if (Platform.OS === 'web') return [];
  const perm = await MediaLibrary.getPermissionsAsync(false, ['audio']);
  if (!perm.granted) return [];
  const ids: ImportedFile[] = [];
  let after: string | undefined;
  for (let pageNo = 0; pageNo < 10; pageNo++) {
    const page = await MediaLibrary.getAssetsAsync({ mediaType: MediaLibrary.MediaType.audio, first: 100, after, createdAfter: sinceMs, sortBy: [[MediaLibrary.SortBy.creationTime, false]] });
    for (const a of page.assets) {
      // Голосовые сообщения и записи разговоров — не музыка.
      if ((a.duration && a.duration < 45) || /^(ptt|aud|voice|recording|call|запись|голос)/i.test(a.filename) || /\.(amr|3gp|3ga)$/i.test(a.filename)) continue;
      ids.push({ ...(await addFile(a.filename, a.uri, a.duration || undefined, { from: 'память телефона', at: Date.now() }, cover)), name: a.filename, size: 0 });
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
  const r = await importAudioFiles(res.assets.map((a) => ({ uri: a.uri, name: a.name, mime: a.mimeType })), 'выбор файла');
  return r.trackIds.length;
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
