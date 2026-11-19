// Названия песен из файлов, которые прислали в Telegram или скачали с сайтов. В них часто
// дописывают имя бота, адрес сайта или подчёркивания вместо пробелов. Здесь это убирается,
// а из имени файла «Исполнитель - Название» достаются поля, если в файле нет тегов.

const SITE = String.raw`(?:[a-zа-яё0-9-]+\.)+(?:fm|net|ru|com|org|me|cc|su|xyz|top|pro|info|tv|io|club|online|site|biz|music|рф)`;

const JUNK: RegExp[] = [
  // (@SomeBot), [@channel], @musicbot в конце
  /\s*[[(]\s*@[\w.]+\s*[\])]/gi,
  /\s*@\w*bot\b/gi,
  // (t.me/channel), [muzofond.fm], (скачано с site.ru)
  new RegExp(String.raw`\s*[[(][^\])]*(?:t\.me/\w+|${SITE})[^\])]*[\])]`, 'gi'),
  new RegExp(String.raw`\s*[-–—|]\s*(?:www\.)?${SITE}\s*$`, 'gi'),
  /\s*[[(]\s*(?:скачано|загружено|downloaded|скачать)[^\])]*[\])]/gi,
];

/** Убирает имена ботов, адреса сайтов и лишние символы. */
export function cleanImportedName(raw: string | undefined | null): string {
  let s = String(raw ?? '').replace(/\.(mp3|m4a|aac|flac|ogg|opus|wav|wma|alac|aiff?)$/i, '');
  if (!/\s/.test(s) && s.includes('_')) s = s.replace(/_+/g, ' ');
  for (const r of JUNK) s = s.replace(r, '');
  return s.replace(/\s{2,}/g, ' ').replace(/^[\s\-–—|.]+|[\s\-–—|]+$/g, '').trim();
}

/** «01. Исполнитель - Название» из имени файла. */
export function parseFileName(name: string): { artist?: string; title: string } {
  const base = cleanImportedName(name).replace(/^\d{1,3}[\s.)_-]+(?=\D)/, '');
  // «Исполнитель - Название»; без пробелов («Artist-Title») — только если с обеих сторон есть буквы, чтобы «track-02» не разрезать.
  const spaced = base.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  const tight = base.match(/^(.+?)[-–—](.+)$/);
  const hasLetters = (x: string) => /\p{L}{2}/u.test(x);
  const m = spaced ?? (tight && hasLetters(tight[1]) && hasLetters(tight[2]) ? tight : null);
  return m ? { artist: m[1].trim(), title: m[2].trim() } : { title: base || name };
}

const AUDIO_EXT = /\.(mp3|m4a|aac|flac|ogg|oga|opus|wav|wma|alac|aiff?|mka)$/i;

/** Подходит ли присланный файл: по типу или по расширению (Telegram иногда пишет application/octet-stream). */
export const isAudioFile = (mime: string | null | undefined, name: string) => /^audio\//i.test(mime ?? '') || AUDIO_EXT.test(name);

/**
 * Служебное имя файла, в котором нет названия песни. Telegram при «Поделиться» отдаёт файл из своего
 * кэша с именем «<номер сервера>_<номер документа>.mp3» (например, 2_5341234123412341234.mp3);
 * так же выглядят имена, которые придумывают системные загрузчики.
 */
export function isOpaqueName(name: string): boolean {
  const base = name.replace(/\.[a-z0-9]{2,5}$/i, '').trim();
  return !base
    || /^-?\d+_-?\d{6,}$/.test(base)
    || /^(audio|file|document|track|music|sound|voice|ptt)[\s_-]*[\d_\-\s:.]*$/i.test(base)
    || /^[0-9a-f]{16,}$/i.test(base)
    || /^\d+$/.test(base);
}

/**
 * Путь к копии файла в правильный file://-адрес. expo-share-intent отдаёт «file://» + путь как есть, без
 * кодирования. В именах файлов бывают пробелы, кириллица, «#», «?» и «%»: без кодирования адрес обрезается
 * на «#» (всё после него считается якорем) и файл «не находится». Поэтому каждую часть пути кодируем.
 */
export function fileUri(path: string): string {
  if (/^content:\/\//i.test(path)) return path;
  const raw = path.replace(/^file:\/\//i, '');
  return `file://${raw.split('/').map(encodeURIComponent).join('/')}`;
}
