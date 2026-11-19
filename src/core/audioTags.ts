// Чтение тегов из аудиофайлов без нативных модулей: ID3v2 (2.2–2.4), ID3v1, FLAC, Ogg (Vorbis/Opus), MP4/M4A.
// Русские MP3 часто записаны в кодировке Windows-1251 внутри полей, помеченных как Latin-1:
// такие поля распознаются и переводятся, иначе вместо названия получаются «кракозябры».

import type { AudioQuality, ExplicitState } from './types';

export interface AudioTags {
  title?: string;
  artist?: string;
  album?: string;
  year?: number;
  genre?: string[];
  trackNumber?: number;
  isrc?: string;
  mbid?: string;
  bpm?: number;
  lyrics?: string;
  explicit: ExplicitState;
  durationSec?: number;
  quality?: AudioQuality;
  picture?: { mime: string; data: Uint8Array };
}

export type ByteReader = (offset: number, length: number) => Promise<Uint8Array>;

const latin1 = (b: Uint8Array, s = 0, e = b.length) => {
  let out = '';
  for (let i = s; i < e; i++) out += String.fromCharCode(b[i]);
  return out;
};

export function decodeUtf8(b: Uint8Array, s = 0, e = b.length): string {
  let out = '';
  let i = s;
  while (i < e) {
    const c = b[i++];
    if (c < 0x80) out += String.fromCharCode(c);
    else if (c < 0xe0) out += String.fromCharCode(((c & 31) << 6) | (b[i++] & 63));
    else if (c < 0xf0) { out += String.fromCharCode(((c & 15) << 12) | ((b[i] & 63) << 6) | (b[i + 1] & 63)); i += 2; }
    else { out += String.fromCodePoint(((c & 7) << 18) | ((b[i] & 63) << 12) | ((b[i + 1] & 63) << 6) | (b[i + 2] & 63)); i += 3; }
  }
  return out;
}

function utf16(b: Uint8Array, s: number, e: number, big: boolean): string {
  let out = '';
  for (let i = s; i + 1 < e; i += 2) out += String.fromCharCode(big ? (b[i] << 8) | b[i + 1] : b[i] | (b[i + 1] << 8));
  return out;
}

// Windows-1251, символы 0x80–0xBF (0xC0–0xFF — это А–я подряд).
const CP1251_HIGH = 'ЂЃ‚ѓ„…†‡€‰Љ‹ЊЌЋЏђ‘’“”•–—\u0098™љ›њќћџ\u00a0ЎўЈ¤Ґ¦§Ё©Є«¬\u00ad®Ї°±Ііґµ¶·ё№є»јЅѕї';

export function decodeCp1251(b: Uint8Array, s = 0, e = b.length): string {
  let out = '';
  for (let i = s; i < e; i++) {
    const c = b[i];
    out += c < 0x80 ? String.fromCharCode(c) : c >= 0xc0 ? String.fromCharCode(0x410 + c - 0xc0) : CP1251_HIGH[c - 0x80];
  }
  return out;
}

/** Корректная ли это последовательность UTF-8 с хотя бы одним многобайтным символом. */
function isUtf8(b: Uint8Array, s: number, e: number): boolean {
  let multi = false;
  for (let i = s; i < e; i++) {
    const c = b[i];
    if (c < 0x80) continue;
    const n = c >= 0xf0 && c < 0xf5 ? 3 : c >= 0xe0 ? 2 : c >= 0xc2 && c < 0xe0 ? 1 : -1;
    if (n < 0 || i + n > e - 1) return false;
    for (let k = 1; k <= n; k++) if ((b[i + k] & 0xc0) !== 0x80) return false;
    i += n;
    multi = true;
  }
  return multi;
}

/**
 * Однобайтный текст неизвестной кодировки: UTF-8, Windows-1251 или Latin-1.
 * Кириллица в 1251 идёт подряд старшими байтами, а западные имена (Beyoncé) — редкими одиночными.
 */
export function decodeSingleByte(b: Uint8Array, s = 0, e = b.length): string {
  let high = 0, letters = 0, run = 0, maxRun = 0, ctrl = false;
  for (let i = s; i < e; i++) {
    const c = b[i];
    if (c >= 0x80) { high++; run++; maxRun = Math.max(maxRun, run); if (c < 0xa0) ctrl = true; }
    else { run = 0; if ((c | 32) >= 97 && (c | 32) <= 122) letters++; }
  }
  if (!high) return latin1(b, s, e);
  if (isUtf8(b, s, e)) return decodeUtf8(b, s, e);
  if (ctrl || maxRun >= 3 || high >= letters) return decodeCp1251(b, s, e);
  return latin1(b, s, e);
}

function id3Text(b: Uint8Array, enc: number, s: number, e: number): string {
  let text: string;
  if (enc === 0) text = decodeSingleByte(b, s, e);
  else if (enc === 3) text = decodeUtf8(b, s, e);
  else if (enc === 2) text = utf16(b, s, e, true);
  else if (b[s] === 0xfe && b[s + 1] === 0xff) text = utf16(b, s + 2, e, true);
  else if (b[s] === 0xff && b[s + 1] === 0xfe) text = utf16(b, s + 2, e, false);
  else text = utf16(b, s, e, false);
  return text.replace(/\u0000+$/g, '');
}

/** Конец строки, завершённой нулём, с учётом ширины символа кодировки. */
function terminator(b: Uint8Array, s: number, e: number, enc: number): number {
  if (enc === 1 || enc === 2) {
    for (let i = s; i + 1 < e; i += 2) if (!b[i] && !b[i + 1]) return i;
    return e;
  }
  for (let i = s; i < e; i++) if (!b[i]) return i;
  return e;
}

const syncsafe = (b: Uint8Array, p: number) => (b[p] << 21) | (b[p + 1] << 14) | (b[p + 2] << 7) | b[p + 3];
const be32 = (b: Uint8Array, p: number) => ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0;
const le32 = (b: Uint8Array, p: number) => (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0;

function applyAdvisory(tags: AudioTags, raw: string) {
  const v = raw.trim().toLowerCase();
  if (['1', '4', 'explicit', 'yes', 'true'].includes(v)) tags.explicit = 'explicit';
  else if (['2', 'clean', 'edited'].includes(v)) tags.explicit = 'clean';
  else if (['0', 'no', 'false', 'notexplicit'].includes(v)) tags.explicit = 'not_explicit';
}

function firstInt(v: string): number | undefined {
  const m = v.match(/\d+/);
  return m ? Number(m[0]) : undefined;
}

function yearOf(v: string): number | undefined {
  const m = v.match(/(?:^|\D)(\d{4})(?:\D|$)/);
  return m ? Number(m[1]) : undefined;
}

function genreList(v: string): string[] {
  return v
    .replace(/^\((\d+)\)$/, '')
    .split(/[;/,\u0000]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Снимает «рассинхронизацию» ID3: после каждого байта 0xFF вставлен лишний 0x00. */
function unsync(b: Uint8Array): Uint8Array {
  const out = new Uint8Array(b.length);
  let n = 0;
  for (let i = 0; i < b.length; i++) {
    out[n++] = b[i];
    if (b[i] === 0xff && b[i + 1] === 0x00) i++;
  }
  return out.subarray(0, n);
}

function parseId3(tag: Uint8Array, tags: AudioTags) {
  const major = tag[3];
  const flags = tag[5];
  const size = syncsafe(tag, 6);
  // В версиях 2.2 и 2.3 флаг рассинхронизации относится ко всему тегу, в 2.4 — к каждому кадру.
  const b = (flags & 0x80) && major < 4 ? Uint8Array.from([...tag.subarray(0, 10), ...unsync(tag.subarray(10, 10 + size))]) : tag;
  let p = 10;
  if (flags & 0x40) p += major === 4 ? syncsafe(b, p) : be32(b, p) + 4;
  const end = Math.min(10 + size, b.length);
  const idLen = major === 2 ? 3 : 4;
  const headLen = major === 2 ? 6 : 10;
  let albumArtist: string | undefined;
  while (p + headLen <= end && b[p]) {
    const id = latin1(b, p, p + idLen);
    let frameSize: number;
    if (major === 2) frameSize = (b[p + 3] << 16) | (b[p + 4] << 8) | b[p + 5];
    else if (major === 4) frameSize = syncsafe(b, p + 4);
    else frameSize = be32(b, p + 4);
    if (frameSize <= 0) break;
    const fmt = major === 2 ? 0 : b[p + 9];
    let s = p + headLen;
    const e = Math.min(s + frameSize, end);
    p = s + frameSize;
    // Сжатые и зашифрованные кадры пропускаем, служебные байты перед данными учитываем.
    if (major === 4) {
      if (fmt & 0x0c) continue;
      if (fmt & 0x40) s += 1;
      if (fmt & 0x01) s += 4;
    } else if (major === 3) {
      if (fmt & 0xc0) continue;
      if (fmt & 0x20) s += 1;
    }
    if (s >= e) continue;
    const d = major === 4 && (fmt & 0x02 || flags & 0x80) ? unsync(b.subarray(s, e)) : b.subarray(s, e);
    const enc = d[0];
    const text = () => id3Text(d, enc, 1, d.length);
    const step = enc === 1 || enc === 2 ? 2 : 1;
    switch (id) {
      case 'TIT2': case 'TT2': tags.title = text(); break;
      case 'TPE1': case 'TP1': tags.artist = text().replace(/\u0000/g, ', '); break;
      case 'TPE2': case 'TP2': albumArtist = text().replace(/\u0000/g, ', '); break;
      case 'TALB': case 'TAL': tags.album = text(); break;
      case 'TDRC': case 'TYER': case 'TYE': case 'TDOR': tags.year ??= yearOf(text()); break;
      case 'TCON': case 'TCO': tags.genre = genreList(text()); break;
      case 'TRCK': case 'TRK': tags.trackNumber = firstInt(text()); break;
      case 'TSRC': case 'TRC': tags.isrc = text().trim(); break;
      case 'TBPM': case 'TBP': tags.bpm = firstInt(text()); break;
      case 'TLEN': case 'TLE': { const ms = firstInt(text()); if (ms) tags.durationSec ??= ms / 1000; break; }
      case 'TXXX': case 'TXX': {
        const split = terminator(d, 1, d.length, enc);
        const key = id3Text(d, enc, 1, split).toUpperCase();
        const value = id3Text(d, enc, split + step, d.length);
        if (key === 'ITUNESADVISORY' || key === 'EXPLICIT' || key === 'CONTENTADVISORY') applyAdvisory(tags, value);
        if (key === 'MUSICBRAINZ TRACK ID' || key === 'MUSICBRAINZ RELEASE TRACK ID') tags.mbid ??= value.trim();
        if (key === 'ISRC') tags.isrc ??= value.trim();
        break;
      }
      case 'UFID': {
        const split = terminator(d, 0, d.length, 0);
        if (latin1(d, 0, split) === 'http://musicbrainz.org') tags.mbid ??= latin1(d, split + 1, d.length);
        break;
      }
      case 'USLT': case 'ULT': {
        const descEnd = terminator(d, 4, d.length, enc);
        tags.lyrics = id3Text(d, enc, descEnd + step, d.length);
        break;
      }
      case 'APIC': {
        const mimeEnd = terminator(d, 1, d.length, 0);
        const mime = latin1(d, 1, mimeEnd) || 'image/jpeg';
        const type = d[mimeEnd + 1];
        const descEnd = terminator(d, mimeEnd + 2, d.length, enc);
        const data = d.slice(descEnd + step);
        // Обложка альбома (тип 3) важнее остальных картинок.
        if (data.length > 16 && (!tags.picture || type === 3)) tags.picture = { mime: mime.includes('/') ? mime : `image/${mime.toLowerCase()}`, data };
        break;
      }
      case 'PIC': {
        const fmtName = latin1(d, 1, 4).toUpperCase();
        const descEnd = terminator(d, 5, d.length, enc);
        const data = d.slice(descEnd + step);
        if (data.length > 16 && (!tags.picture || d[4] === 3)) tags.picture = { mime: fmtName === 'PNG' ? 'image/png' : 'image/jpeg', data };
        break;
      }
    }
  }
  if (!tags.artist && albumArtist) tags.artist = albumArtist;
}

/** ID3v1: 128 байт в конце файла. Встречается у старых MP3, часто в Windows-1251. */
export function parseId3v1(b: Uint8Array): Partial<AudioTags> | null {
  if (b.length < 128 || latin1(b, 0, 3) !== 'TAG') return null;
  const field = (s: number, e: number) => {
    let stop = s;
    while (stop < e && b[stop]) stop++;
    return decodeSingleByte(b, s, stop).trim();
  };
  const out: Partial<AudioTags> = { title: field(3, 33) || undefined, artist: field(33, 63) || undefined, album: field(63, 93) || undefined, year: yearOf(field(93, 97)) };
  if (b[125] === 0 && b[126]) out.trackNumber = b[126];
  return out;
}

function applyVorbis(b: Uint8Array, start: number, end: number, tags: AudioTags) {
  let p = start;
  p += 4 + le32(b, p); // строка производителя
  const count = le32(b, p);
  p += 4;
  for (let i = 0; i < count && p + 4 <= end; i++) {
    const len = le32(b, p);
    p += 4;
    const stop = Math.min(p + len, end);
    const entry = decodeUtf8(b, p, stop);
    p += len;
    const eq = entry.indexOf('=');
    if (eq < 0) continue;
    const key = entry.slice(0, eq).toUpperCase();
    const value = entry.slice(eq + 1);
    switch (key) {
      case 'TITLE': tags.title = value; break;
      case 'ARTIST': tags.artist = tags.artist ? `${tags.artist}, ${value}` : value; break;
      case 'ALBUM': tags.album = value; break;
      case 'DATE': case 'YEAR': case 'ORIGINALDATE': tags.year ??= yearOf(value); break;
      case 'GENRE': tags.genre = [...(tags.genre ?? []), ...genreList(value)]; break;
      case 'TRACKNUMBER': tags.trackNumber = firstInt(value); break;
      case 'ISRC': tags.isrc = value.trim(); break;
      case 'BPM': tags.bpm = firstInt(value); break;
      case 'MUSICBRAINZ_TRACKID': case 'MUSICBRAINZ_RELEASETRACKID': tags.mbid ??= value.trim(); break;
      case 'LYRICS': case 'UNSYNCEDLYRICS': case 'SYNCEDLYRICS': tags.lyrics = value; break;
      case 'ITUNESADVISORY': case 'EXPLICIT': case 'CONTENTADVISORY': applyAdvisory(tags, value); break;
      case 'ALBUMARTIST': if (!tags.artist) tags.artist = value; break;
      case 'METADATA_BLOCK_PICTURE': {
        const pic = base64(value);
        const parsed = pic && flacPicture(pic, 0, pic.length);
        if (parsed && (!tags.picture || parsed.type === 3)) tags.picture = { mime: parsed.mime, data: parsed.data };
        break;
      }
      case 'COVERART': { const pic = base64(value); if (pic && pic.length > 16) tags.picture ??= { mime: 'image/jpeg', data: pic }; break; }
    }
  }
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function base64(text: string): Uint8Array | null {
  const clean = text.replace(/[^A-Za-z0-9+/]/g, '');
  if (clean.length < 8) return null;
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let n = 0, acc = 0, bits = 0;
  for (const ch of clean) {
    acc = (acc << 6) | B64.indexOf(ch);
    bits += 6;
    if (bits >= 8) { bits -= 8; out[n++] = (acc >> bits) & 0xff; }
  }
  return out.subarray(0, n);
}

/** Блок картинки FLAC (он же METADATA_BLOCK_PICTURE в Ogg). */
function flacPicture(b: Uint8Array, s: number, e: number): { type: number; mime: string; data: Uint8Array } | null {
  let q = s;
  const type = be32(b, q); q += 4;
  const mimeLen = be32(b, q); q += 4;
  const mime = latin1(b, q, q + mimeLen) || 'image/jpeg'; q += mimeLen;
  q += 4 + be32(b, q); // описание
  q += 16; // ширина, высота, глубина цвета, палитра
  const size = be32(b, q); q += 4;
  if (q + size > e || size < 16) return null;
  return { type, mime, data: b.slice(q, q + size) };
}

function parseFlac(b: Uint8Array, tags: AudioTags) {
  let p = 4;
  for (;;) {
    if (p + 4 > b.length) return;
    const last = b[p] & 0x80;
    const type = b[p] & 0x7f;
    const len = (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3];
    const s = p + 4;
    const e = s + len;
    if (type === 0 && e <= b.length) {
      const rate = (b[s + 10] << 12) | (b[s + 11] << 4) | (b[s + 12] >> 4);
      const bits = (((b[s + 12] & 1) << 4) | (b[s + 13] >> 4)) + 1;
      const samples = (b[s + 13] & 15) * 2 ** 32 + be32(b, s + 14);
      if (rate) tags.durationSec = samples / rate;
      tags.quality = { codec: 'FLAC', lossless: true, sampleRateHz: rate, bitDepth: bits };
    } else if (type === 4 && e <= b.length) applyVorbis(b, s, e, tags);
    else if (type === 6 && e <= b.length) {
      const pic = flacPicture(b, s, e);
      if (pic && (!tags.picture || pic.type === 3)) tags.picture = { mime: pic.mime, data: pic.data };
    }
    p = e;
    if (last) return;
  }
}

function parseOgg(b: Uint8Array, tags: AudioTags) {
  // Склеиваем содержимое первых страниц: заголовок комментариев может занимать несколько.
  const packet: number[] = [];
  let p = 0;
  let pages = 0;
  let codec = '';
  while (p + 27 < b.length && latin1(b, p, p + 4) === 'OggS' && pages < 400) {
    const segs = b[p + 26];
    let size = 0;
    for (let i = 0; i < segs; i++) size += b[p + 27 + i];
    const start = p + 27 + segs;
    if (pages === 0) {
      if (latin1(b, start, start + 8) === 'OpusHead') { codec = 'Opus'; tags.quality = { codec, sampleRateHz: 48000 }; }
      else if (latin1(b, start + 1, start + 7) === 'vorbis') {
        codec = 'Vorbis';
        tags.quality = { codec, sampleRateHz: le32(b, start + 12), bitrateKbps: Math.round(le32(b, start + 20) / 1000) || undefined };
      }
    } else for (let i = start; i < start + size && i < b.length; i++) packet.push(b[i]);
    p = start + size;
    pages++;
    if (packet.length > 16 && b[start + size] === undefined) break;
  }
  const data = Uint8Array.from(packet);
  if (codec === 'Opus' && latin1(data, 0, 8) === 'OpusTags') applyVorbis(data, 8, data.length, tags);
  if (codec === 'Vorbis' && latin1(data, 1, 7) === 'vorbis') applyVorbis(data, 7, data.length, tags);
}

function mp4Walk(b: Uint8Array, s: number, e: number, visit: (type: string, ds: number, de: number) => void) {
  let p = s;
  while (p + 8 <= e) {
    let size = be32(b, p);
    const type = latin1(b, p + 4, p + 8);
    let head = 8;
    if (size === 1) { size = be32(b, p + 12); head = 16; }
    else if (size === 0) size = e - p;
    if (size < head) return;
    visit(type, p + head, Math.min(p + size, e));
    p += size;
  }
}

function parseMp4(b: Uint8Array, tags: AudioTags) {
  const data = (s: number, e: number, fn: (kind: number, ds: number, de: number) => void) =>
    mp4Walk(b, s, e, (t, ds, de) => { if (t === 'data') fn(be32(b, ds), ds + 8, de); });
  const text = (s: number, e: number, set: (v: string) => void) => data(s, e, (_k, ds, de) => set(decodeUtf8(b, ds, de)));
  const walk = (type: string, s: number, e: number) => {
    if (type === 'moov' || type === 'udta' || type === 'ilst') mp4Walk(b, s, e, walk);
    else if (type === 'meta') mp4Walk(b, s + 4, e, walk);
    else if (type === 'mvhd') {
      const v = b[s];
      const scale = v ? be32(b, s + 20) : be32(b, s + 12);
      const dur = v ? be32(b, s + 24) * 2 ** 32 + be32(b, s + 28) : be32(b, s + 16);
      if (scale) tags.durationSec = dur / scale;
    }
    else if (type === '©nam') text(s, e, (v) => { tags.title = v; });
    else if (type === '©ART') text(s, e, (v) => { tags.artist = v; });
    else if (type === '©alb') text(s, e, (v) => { tags.album = v; });
    else if (type === '©day') text(s, e, (v) => { tags.year = yearOf(v); });
    else if (type === '©gen') text(s, e, (v) => { tags.genre = genreList(v); });
    else if (type === '©lyr') text(s, e, (v) => { tags.lyrics = v; });
    else if (type === 'tmpo') data(s, e, (_k, ds) => { tags.bpm = (b[ds] << 8) | b[ds + 1]; });
    else if (type === 'trkn') data(s, e, (_k, ds) => { tags.trackNumber = (b[ds + 2] << 8) | b[ds + 3]; });
    else if (type === 'rtng') data(s, e, (_k, ds) => { applyAdvisory(tags, String(b[ds])); });
    else if (type === 'covr') data(s, e, (k, ds, de) => { tags.picture ??= { mime: k === 14 ? 'image/png' : 'image/jpeg', data: b.slice(ds, de) }; });
  };
  mp4Walk(b, 0, b.length, walk);
}

const HEAD_BYTES = 2 * 1024 * 1024;
const MAX_TAG_BYTES = 8 * 1024 * 1024;

export async function readAudioTags(read: ByteReader, fileSize: number): Promise<AudioTags> {
  const tags: AudioTags = { explicit: 'unknown' };
  let head = await read(0, Math.min(HEAD_BYTES, fileSize));
  const magic = latin1(head, 0, 4);
  if (magic.startsWith('ID3')) {
    const size = syncsafe(head, 6) + 10;
    if (size > head.length) head = await read(0, Math.min(size, MAX_TAG_BYTES, fileSize));
    parseId3(head, tags);
    if (tags.title === undefined && head[size] === 0x66) { /* FLAC с ID3 встречается редко */ }
    const sync = head.subarray(size, size + 4);
    if (sync[0] === 0xff && (sync[1] & 0xe0) === 0xe0) tags.quality = { codec: 'MP3', ...mp3Bitrate(sync) };
  } else if (magic === 'fLaC') {
    // Большая обложка может не поместиться в первые 2 МБ: дочитываем блоки метаданных целиком.
    let p = 4;
    for (let i = 0; i < 64 && p + 4 <= fileSize; i++) {
      const h = p + 4 <= head.length ? head.subarray(p, p + 4) : await read(p, 4);
      p += 4 + ((h[1] << 16) | (h[2] << 8) | h[3]);
      if (h[0] & 0x80) break;
    }
    if (p > head.length) head = await read(0, Math.min(p, MAX_TAG_BYTES, fileSize));
    parseFlac(head, tags);
  }
  else if (magic === 'OggS') parseOgg(head, tags);
  else if (latin1(head, 4, 8) === 'ftyp') {
    // moov может лежать в конце файла: ищем его по цепочке атомов верхнего уровня.
    let p = 0;
    let moov: Uint8Array | null = null;
    while (p + 8 <= fileSize && !moov) {
      const h = p + 16 <= head.length ? head.subarray(p, p + 16) : await read(p, 16);
      let size = be32(h, 0);
      const type = latin1(h, 4, 8);
      if (size === 1) size = be32(h, 12);
      if (size === 0) size = fileSize - p;
      if (size < 8) break;
      if (type === 'moov') moov = await read(p, Math.min(size, MAX_TAG_BYTES));
      p += size;
    }
    if (moov) parseMp4(moov, tags);
    tags.quality = { codec: 'AAC/ALAC' };
  } else if (head[0] === 0xff && (head[1] & 0xe0) === 0xe0) tags.quality = { codec: 'MP3', ...mp3Bitrate(head) };
  else if (magic === 'RIFF') tags.quality = { codec: 'WAV', lossless: true, sampleRateHz: le32(head, 24), bitDepth: head[34] | (head[35] << 8) };
  if ((!tags.title || !tags.artist) && fileSize > 256 && magic !== 'fLaC' && magic !== 'OggS' && magic !== 'RIFF' && latin1(head, 4, 8) !== 'ftyp') {
    const v1 = parseId3v1(await read(fileSize - 128, 128));
    if (v1) {
      tags.title ||= v1.title; tags.artist ||= v1.artist; tags.album ||= v1.album;
      tags.year ??= v1.year; tags.trackNumber ??= v1.trackNumber;
    }
  }
  return tags;
}

const MPEG1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const RATES = [44100, 48000, 32000];

function mp3Bitrate(h: Uint8Array): AudioQuality {
  const isMpeg1 = ((h[1] >> 3) & 3) === 3 && ((h[1] >> 1) & 3) === 1;
  if (!isMpeg1) return {};
  return { bitrateKbps: MPEG1_L3[h[2] >> 4] || undefined, sampleRateHz: RATES[(h[2] >> 2) & 3] };
}
