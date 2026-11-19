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
  const m = base.match(/^(.+?)\s+[-–—]\s+(.+)$/) ?? base.match(/^(.+?)\s*[-–—]\s*(.+)$/);
  return m ? { artist: m[1].trim(), title: m[2].trim() } : { title: base || name };
}

const AUDIO_EXT = /\.(mp3|m4a|aac|flac|ogg|oga|opus|wav|wma|alac|aiff?|mka)$/i;

/** Подходит ли присланный файл: по типу или по расширению (Telegram иногда пишет application/octet-stream). */
export const isAudioFile = (mime: string | null | undefined, name: string) => /^audio\//i.test(mime ?? '') || AUDIO_EXT.test(name);
