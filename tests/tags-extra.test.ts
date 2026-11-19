// Теги в том виде, в каком они встречаются в файлах из Telegram-ботов и со старых сайтов:
// Windows-1251 в полях Latin-1, только ID3v1, ID3v2.4 с флагами кадров, рассинхронизация,
// обложки в Ogg/Opus и FLAC. Байты собираются здесь вручную, чтобы проверка не зависела от программ.

import { describe, expect, it } from 'vitest';
import { decodeCp1251, decodeSingleByte, parseId3v1, readAudioTags } from '@/core/audioTags';

const reader = (data: Uint8Array) => async (o: number, l: number) => data.subarray(o, o + l);
const read = (data: Uint8Array) => readAudioTags(reader(data), data.length);

function cp1251(text: string): number[] {
  return [...text].map((ch) => {
    const c = ch.charCodeAt(0);
    if (c < 0x80) return c;
    if (c >= 0x410 && c <= 0x44f) return 0xc0 + c - 0x410;
    if (ch === 'Ё') return 0xa8;
    if (ch === 'ё') return 0xb8;
    throw new Error(ch);
  });
}
const latin1 = (text: string) => [...text].map((c) => c.charCodeAt(0));
const utf8 = (text: string) => [...new TextEncoder().encode(text)];
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const syncsafe = (n: number) => [(n >> 21) & 127, (n >> 14) & 127, (n >> 7) & 127, n & 127];
const le32 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];

// Кусочек «MP3»: заголовок кадра MPEG-1 Layer III 128 кбит/с и нули.
const MPEG = [0xff, 0xfb, 0x90, 0x64, ...new Array(400).fill(0)];
// «Картинка» с байтами 0xFF, чтобы проверить рассинхронизацию.
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...new Array(40).fill(0).map((_, i) => (i % 3 ? i : 0xff)), 0xff, 0xd9];

function frame(major: 3 | 4, id: string, body: number[], fmt = 0): number[] {
  return [...latin1(id), ...(major === 4 ? syncsafe(body.length) : be32(body.length)), 0, fmt, ...body];
}
function id3(major: 3 | 4, frames: number[][], flags = 0): number[] {
  const body = frames.flat();
  return [...latin1('ID3'), major, 0, flags, ...syncsafe(body.length), ...body];
}
function v1(title: number[], artist: number[]): number[] {
  const pad = (b: number[], n: number) => [...b, ...new Array(n - b.length).fill(0)];
  return [...latin1('TAG'), ...pad(title, 30), ...pad(artist, 30), ...pad([], 30), ...latin1('2019'), ...pad([], 28), 0, 7, 255];
}
function unsyncBytes(b: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < b.length; i++) { out.push(b[i]); if (b[i] === 0xff && (b[i + 1] === undefined || b[i + 1] === 0 || b[i + 1] >= 0xe0)) out.push(0); }
  return out;
}

describe('кодировки однобайтных полей', () => {
  it('Windows-1251 совпадает с эталонным декодером', () => {
    const all = Uint8Array.from({ length: 128 }, (_, i) => 128 + i);
    expect(decodeCp1251(all)).toBe(new TextDecoder('windows-1251').decode(all));
  });
  it('распознаёт кириллицу в 1251, UTF-8 и западные имена', () => {
    expect(decodeSingleByte(Uint8Array.from(cp1251('Земфира')))).toBe('Земфира');
    expect(decodeSingleByte(Uint8Array.from(cp1251('DJ Смэш')))).toBe('DJ Смэш');
    expect(decodeSingleByte(Uint8Array.from(utf8('Моргенштерн')))).toBe('Моргенштерн');
    expect(decodeSingleByte(Uint8Array.from(latin1('Beyoncé')))).toBe('Beyoncé');
    expect(decodeSingleByte(Uint8Array.from(latin1('Sigur Rós')))).toBe('Sigur Rós');
  });
});

describe('ID3', () => {
  it('ID3v2.3: русские названия в Windows-1251 в полях Latin-1', async () => {
    const tag = id3(3, [frame(3, 'TIT2', [0, ...cp1251('Группа крови')]), frame(3, 'TPE1', [0, ...cp1251('Кино')])]);
    const t = await read(Uint8Array.from([...tag, ...MPEG]));
    expect(t).toMatchObject({ title: 'Группа крови', artist: 'Кино' });
  });

  it('только ID3v1 в конце файла', async () => {
    const t = await read(Uint8Array.from([...MPEG, ...MPEG, ...v1(cp1251('Мальчик на девятке'), cp1251('DEAD BLONDE'))]));
    expect(t).toMatchObject({ title: 'Мальчик на девятке', artist: 'DEAD BLONDE', year: 2019, trackNumber: 7 });
    expect(parseId3v1(Uint8Array.from(MPEG.slice(0, 128)))).toBeNull();
  });

  it('ID3v2 без названия дополняется из ID3v1', async () => {
    const tag = id3(3, [frame(3, 'TALB', [0, ...latin1('Album')])]);
    const t = await read(Uint8Array.from([...tag, ...MPEG, ...v1(latin1('Song'), latin1('Band'))]));
    expect(t).toMatchObject({ title: 'Song', artist: 'Band', album: 'Album' });
  });

  it('ID3v2.4: UTF-8, кадр с длиной данных и рассинхронизацией, обложка', async () => {
    const apic = [3, ...latin1('image/jpeg'), 0, 3, 0, ...JPEG];
    const coded = [0, 0, 0, 0, ...unsyncBytes(apic)]; // 4 байта «длины данных» + рассинхронизированные данные
    const tag = id3(4, [
      frame(4, 'TIT2', [3, ...utf8('Cadillac')]),
      frame(4, 'TPE1', [3, ...utf8('MORGENSHTERN'), 0, ...utf8('Элджей')]),
      frame(4, 'APIC', coded, 0x03),
    ]);
    const t = await read(Uint8Array.from([...tag, ...MPEG]));
    expect(t).toMatchObject({ title: 'Cadillac', artist: 'MORGENSHTERN, Элджей' });
    expect([...t.picture!.data]).toEqual(JPEG);
    expect(t.picture!.mime).toBe('image/jpeg');
  });

  it('ID3v2.3: рассинхронизация всего тега', async () => {
    const frames = [frame(3, 'TIT2', [0, ...latin1('Song')]), frame(3, 'APIC', [0, ...latin1('image/png'), 0, 3, 0, ...JPEG])].flat();
    const body = unsyncBytes(frames);
    const tag = [...latin1('ID3'), 3, 0, 0x80, ...syncsafe(body.length), ...body];
    const t = await read(Uint8Array.from([...tag, ...MPEG]));
    expect(t.title).toBe('Song');
    expect([...t.picture!.data]).toEqual(JPEG);
  });

  it('исполнитель альбома, если нет исполнителя песни', async () => {
    const tag = id3(3, [frame(3, 'TIT2', [0, ...latin1('Song')]), frame(3, 'TPE2', [0, ...latin1('Band')])]);
    expect(await read(Uint8Array.from([...tag, ...MPEG]))).toMatchObject({ artist: 'Band' });
  });

  it('файл без тегов: пусто, без ошибок', async () => {
    const t = await read(Uint8Array.from([...MPEG, ...MPEG]));
    expect(t.title).toBeUndefined();
    expect(t.picture).toBeUndefined();
  });
});

function oggPage(packet: number[], seq: number): number[] {
  const lacing: number[] = [];
  let left = packet.length;
  while (left >= 255) { lacing.push(255); left -= 255; }
  lacing.push(left);
  return [...latin1('OggS'), 0, seq === 0 ? 2 : 0, ...new Array(8).fill(0), 1, 0, 0, 0, ...le32(seq), 0, 0, 0, 0, lacing.length, ...lacing, ...packet];
}
function pictureBlock(): number[] {
  const mime = latin1('image/jpeg');
  return [...be32(3), ...be32(mime.length), ...mime, ...be32(0), ...be32(1), ...be32(1), ...be32(24), ...be32(0), ...be32(JPEG.length), ...JPEG];
}

describe('обложки в Ogg/Opus и FLAC', () => {
  it('Opus: METADATA_BLOCK_PICTURE', async () => {
    const pic = Buffer.from(pictureBlock()).toString('base64');
    const comments = [`TITLE=Лида`, `ARTIST=Лида`, `METADATA_BLOCK_PICTURE=${pic}`].map(utf8);
    const tagsPacket = [...latin1('OpusTags'), ...le32(3), ...latin1('enc'), ...le32(comments.length), ...comments.flatMap((c) => [...le32(c.length), ...c])];
    const head = [...latin1('OpusHead'), 1, 2, 0, 0, ...le32(48000), 0, 0, 0];
    const file = [...oggPage(head, 0), ...oggPage(tagsPacket, 1)];
    const t = await read(Uint8Array.from(file));
    expect(t).toMatchObject({ title: 'Лида', artist: 'Лида' });
    expect([...t.picture!.data]).toEqual(JPEG);
  });

  it('FLAC: обложка больше первых 2 МБ дочитывается', async () => {
    const big = new Array(2.5 * 1024 * 1024).fill(7);
    const mime = latin1('image/jpeg');
    const block = [...be32(3), ...be32(mime.length), ...mime, ...be32(0), ...be32(1), ...be32(1), ...be32(24), ...be32(0), ...be32(big.length), ...big];
    const streaminfo = new Array(34).fill(0);
    const file = [...latin1('fLaC'), 0, 0, 0, 34, ...streaminfo, 0x86, (block.length >> 16) & 255, (block.length >> 8) & 255, block.length & 255, ...block, 0xff, 0xf8];
    const t = await read(Uint8Array.from(file));
    expect(t.picture?.data.length).toBe(big.length);
  });
});
