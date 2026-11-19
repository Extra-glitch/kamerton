// Разбор и создание файлов плейлистов: CSV, JSON, M3U, XSPF и обычный текст.

export interface ImportItem {
  position: number;
  title: string;
  artist: string;
  album?: string;
  durationSec?: number;
  isrc?: string;
  mbid?: string;
}

type Partial_ = Omit<ImportItem, 'position'>;

export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  const first = text.split('\n', 1)[0] ?? '';
  const delim = (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ';' : first.includes('\t') ? '\t' : ',';
  let cell = '';
  let row: string[] = [];
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

const COLUMNS: Record<keyof Partial_, string[]> = {
  title: ['title', 'track', 'name', 'track name', 'track title', 'song', 'song name', 'название', 'название трека', 'трек', 'песня', 'композиция'],
  artist: ['artist', 'artists', 'artist name', 'artist name(s)', 'artist names', 'performer', 'исполнитель', 'исполнители', 'артист', 'артисты'],
  album: ['album', 'album name', 'альбом'],
  durationSec: ['duration', 'length', 'duration_sec', 'duration (ms)', 'track duration (ms)', 'длительность'],
  isrc: ['isrc'],
  mbid: ['mbid', 'musicbrainz', 'recording_mbid'],
};

function parseDuration(raw: string | number | undefined, header = ''): number | undefined {
  if (raw === undefined || raw === '') return undefined;
  const s = String(raw).trim();
  if (s.includes(':')) return s.split(':').reduce((a, x) => a * 60 + Number(x), 0) || undefined;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return header.includes('ms') || n > 36000 ? n / 1000 : n;
}

function parseCsv(text: string): Partial_[] {
  const rows = parseCsvRows(text);
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim().toLowerCase().replace(/^﻿/, ''));
  const col = (k: keyof Partial_) => head.findIndex((h) => COLUMNS[k].includes(h));
  const [ti, ai] = [col('title'), col('artist')];
  const hasHeader = ti >= 0;
  const body = hasHeader ? rows.slice(1) : rows;
  const t = hasHeader ? ti : 1;
  const a = hasHeader ? ai : 0;
  const [al, du, is, mb] = hasHeader ? [col('album'), col('durationSec'), col('isrc'), col('mbid')] : [2, 3, 4, -1];
  return body.map((r) => ({
    title: (r[t] ?? '').trim(), artist: (a >= 0 ? r[a] ?? '' : '').trim(), album: al >= 0 ? r[al]?.trim() || undefined : undefined,
    durationSec: du >= 0 ? parseDuration(r[du], head[du]) : undefined, isrc: is >= 0 ? r[is]?.trim() || undefined : undefined, mbid: mb >= 0 ? r[mb]?.trim() || undefined : undefined,
  }));
}

function fromObject(o: any): Partial_ {
  const artist = o.artist ?? o.artistName ?? o.artists ?? o.performer ?? '';
  return {
    title: String(o.title ?? o.name ?? o.track ?? o.trackName ?? '').trim(),
    artist: (Array.isArray(artist) ? artist.map((x) => x?.name ?? x).join(', ') : String(artist?.name ?? artist)).trim(),
    album: (o.album?.name ?? o.album ?? undefined) || undefined,
    durationSec: o.duration_ms ? o.duration_ms / 1000 : parseDuration(o.durationSec ?? o.duration ?? o.length),
    isrc: o.isrc ?? o.external_ids?.isrc ?? undefined, mbid: o.mbid ?? undefined,
  };
}

const TITLE_KEYS = ['title', 'name', 'trackName', 'trackTitle', 'track_name', 'track_title', 'songName'];
const ARTIST_KEYS = ['artist', 'artists', 'artistName', 'artistNames', 'artist_name', 'performer', 'performers'];

/** Похож ли объект на трек: есть название и исполнитель. */
function looksLikeTrack(o: any): boolean {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
  const title = TITLE_KEYS.map((k) => o[k]).find((v) => typeof v === 'string' && v.trim());
  const artist = ARTIST_KEYS.map((k) => o[k]).find((v) => v && (typeof v === 'string' || Array.isArray(v) || typeof v?.name === 'string'));
  return !!title && !!artist;
}

/** Обходит JSON любой формы (например, архив данных сервиса) и собирает всё, что похоже на треки. */
export function collectJsonTracks(root: unknown, limit = 20000): Partial_[] {
  const out: Partial_[] = [];
  const stack: unknown[] = [root];
  let visited = 0;
  while (stack.length && out.length < limit && visited < 500000) {
    const v = stack.pop() as any;
    visited++;
    if (!v || typeof v !== 'object') continue;
    if (Array.isArray(v)) { for (let i = v.length - 1; i >= 0; i--) stack.push(v[i]); continue; }
    if (v.track && looksLikeTrack(v.track)) { out.push(fromObject({ ...v.track, title: v.track.title ?? v.track.name })); continue; }
    if (looksLikeTrack(v)) { out.push(fromObject({ ...v, title: TITLE_KEYS.map((k) => v[k]).find((x) => typeof x === 'string'), artist: ARTIST_KEYS.map((k) => v[k]).find(Boolean) })); continue; }
    const keys = Object.keys(v);
    for (let i = keys.length - 1; i >= 0; i--) stack.push(v[keys[i]]);
  }
  return out;
}

function parseJson(text: string): Partial_[] {
  const j = JSON.parse(text);
  const list = Array.isArray(j) ? j : j.tracks ?? j.items ?? j.songs ?? j.playlist?.tracks ?? null;
  const direct = Array.isArray(list) ? (list as any[]).map((x) => fromObject(x?.track ?? x)).filter((x) => x.title) : [];
  return direct.length ? direct : collectJsonTracks(j);
}

function parseM3u(text: string): Partial_[] {
  const out: Partial_[] = [];
  let pending: Partial_ | null = null;
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const inf = line.match(/^#EXTINF:\s*(-?\d+(?:\.\d+)?)[^,]*,(.*)$/i);
    if (inf) {
      const [artist, ...rest] = inf[2].split(' - ');
      pending = rest.length ? { artist: artist.trim(), title: rest.join(' - ').trim() } : { artist: '', title: inf[2].trim() };
      if (Number(inf[1]) > 0) pending.durationSec = Number(inf[1]);
    } else if (!line.startsWith('#')) {
      if (pending) out.push(pending);
      else {
        const file = decodeURIComponent(line.split(/[\\/]/).pop() ?? line).replace(/\.[a-z0-9]{2,5}$/i, '');
        const [artist, ...rest] = file.split(' - ');
        out.push(rest.length ? { artist: artist.trim(), title: rest.join(' - ').trim() } : { artist: '', title: file });
      }
      pending = null;
    }
  }
  return out;
}

const xmlDecode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

function parseXspf(text: string): Partial_[] {
  return [...text.matchAll(/<track>([\s\S]*?)<\/track>/g)].map(([, b]) => {
    const tag = (n: string) => { const m = b.match(new RegExp(`<${n}>([\\s\\S]*?)</${n}>`)); return m ? xmlDecode(m[1].trim()) : undefined; };
    const ms = Number(tag('duration'));
    return { title: tag('title') ?? '', artist: tag('creator') ?? '', album: tag('album'), durationSec: ms ? ms / 1000 : undefined };
  });
}

const DURATION_LINE = /^\d{1,2}:\d{2}(?::\d{2})?$/;
const JUNK_LINE = /^(?:e|explicit|\d{1,4}|слушать|скачать|нравится|мне нравится|ещё|еще|добавить|поделиться|скрыть|играть|перемешать|треки|популярное|сингл|альбом|плейлист|[•·|]|\d+\s+(?:трек|трека|треков|прослушиван).*)$/i;
const VERSION_LINE = /^(?:\(.*\)|\[.*\]|.*\b(?:remix|ремикс|version|версия|edit|mix|live|acoustic|slowed|sped up|speed up|prod\.?|instrumental|cover|demo)\b.*)$/i;

/**
 * Список, скопированный со страницы плейлиста в браузере: каждая песня занимает несколько строк
 * («Название», «Исполнители», иногда «Альбом») и заканчивается длительностью вида 3:05.
 */
export function parseCopiedBlocks(text: string): Partial_[] | null {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const durations = lines.reduce<number[]>((a, l, i) => (DURATION_LINE.test(l) ? [...a, i] : a), []);
  if (durations.length < 2 || durations.length * 6 < lines.length) return null;
  const blocks: { lines: string[]; dur: string }[] = [];
  let from = 0;
  for (const d of durations) {
    blocks.push({ lines: lines.slice(from, d).filter((l) => !JUNK_LINE.test(l)), dur: lines[d] });
    from = d + 1;
  }
  // Обычная длина блока без заголовка страницы: два поля или три (с альбомом).
  const lens = blocks.slice(1).map((b) => b.lines.length).filter((n) => n >= 2);
  const counts = new Map<number, number>();
  for (const n of lens) counts.set(Math.min(n, 3), (counts.get(Math.min(n, 3)) ?? 0) + 1);
  const width = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 2;
  const out: Partial_[] = [];
  blocks.forEach((b, i) => {
    let l = i === 0 ? b.lines.slice(-width) : b.lines;
    if (!l.length) return;
    if (l.length > width && VERSION_LINE.test(l[1])) l = [`${l[0]} ${/^[([]/.test(l[1]) ? l[1] : `(${l[1]})`}`, ...l.slice(2)];
    const [title, artist = '', album] = l;
    out.push({ title, artist, album: width >= 3 ? album : undefined, durationSec: parseDuration(b.dur) });
  });
  return out.filter((x) => x.title);
}

/** Меняет местами исполнителя и название, если список был в порядке «Песня — Исполнитель». */
export function swapArtistTitle<T extends { title: string; artist: string }>(items: T[]): T[] {
  return items.map((i) => (i.artist ? { ...i, title: i.artist, artist: i.title } : i));
}

/** Обычный список: «Исполнитель - Название», по строке на песню. */
export function parseText(text: string): Partial_[] {
  const blocks = parseCopiedBlocks(text);
  if (blocks?.length) return blocks;
  return text.split(/\r?\n/).map((l) => l.replace(/^\s*(?:\d+[.)]\s*|[-•*]\s+)/, '').trim()).filter(Boolean).map((line) => {
    const parts = line.split(/\s+[-–—]\s+/);
    return parts.length > 1 ? { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() } : { artist: '', title: line };
  });
}

export function detectFormat(name: string, text: string): 'csv' | 'json' | 'm3u' | 'xspf' | 'text' {
  const ext = name.toLowerCase().split('.').pop();
  const t = text.trimStart();
  if (ext === 'json' || t.startsWith('{') || t.startsWith('[')) return 'json';
  if (ext === 'm3u' || ext === 'm3u8' || t.startsWith('#EXTM3U')) return 'm3u';
  if (ext === 'xspf' || t.startsWith('<?xml') || t.startsWith('<playlist')) return 'xspf';
  if (ext === 'csv' || ext === 'tsv') return 'csv';
  return 'text';
}

export function parsePlaylist(name: string, text: string): ImportItem[] {
  const fmt = detectFormat(name, text);
  const items = fmt === 'csv' ? parseCsv(text) : fmt === 'json' ? parseJson(text) : fmt === 'm3u' ? parseM3u(text) : fmt === 'xspf' ? parseXspf(text) : parseText(text);
  return items.filter((i) => i.title).map((i, n) => ({ ...i, position: n }));
}

const csvCell = (v: unknown) => { const s = String(v ?? ''); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export type ExportFormat = 'm3u8' | 'csv' | 'json' | 'xspf';

export function exportPlaylist(name: string, items: Omit<ImportItem, 'position'>[], fmt: ExportFormat): string {
  if (fmt === 'json') return JSON.stringify({ name, tracks: items }, null, 2);
  if (fmt === 'csv') return ['artist,title,album,duration,isrc', ...items.map((i) => [i.artist, i.title, i.album, i.durationSec ? Math.round(i.durationSec) : '', i.isrc].map(csvCell).join(','))].join('\n');
  if (fmt === 'xspf') {
    const body = items.map((i) => `    <track><title>${xml(i.title)}</title><creator>${xml(i.artist)}</creator>${i.album ? `<album>${xml(i.album)}</album>` : ''}${i.durationSec ? `<duration>${Math.round(i.durationSec * 1000)}</duration>` : ''}</track>`);
    return `<?xml version="1.0" encoding="UTF-8"?>\n<playlist version="1" xmlns="http://xspf.org/ns/0/">\n  <title>${xml(name)}</title>\n  <trackList>\n${body.join('\n')}\n  </trackList>\n</playlist>\n`;
  }
  return ['#EXTM3U', `#PLAYLIST:${name}`, ...items.flatMap((i) => [`#EXTINF:${Math.round(i.durationSec ?? -1)},${i.artist} - ${i.title}`, `${i.artist} - ${i.title}`])].join('\n');
}
