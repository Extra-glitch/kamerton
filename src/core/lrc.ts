import type { LyricLine, Lyrics } from './types';

const STAMP = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

/** Разбирает LRC. Если меток времени нет, возвращает обычный текст. */
export function parseLyrics(text: string, origin: string): Lyrics | null {
  const lines: LyricLine[] = [];
  let synced = false;
  let offset = 0;
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const off = raw.match(/^\[offset:\s*([+-]?\d+)\s*\]/i);
    if (off) { offset = Number(off[1]); continue; }
    if (/^\[[a-z]+:.*\]\s*$/i.test(raw)) continue; // служебные теги [ar:], [ti:]
    const stamps = [...raw.matchAll(STAMP)];
    if (stamps.length) {
      synced = true;
      const body = raw.replace(STAMP, '').trim();
      for (const s of stamps) {
        const frac = s[3] ? Number(s[3].padEnd(3, '0')) : 0;
        lines.push({ timeMs: Number(s[1]) * 60000 + Number(s[2]) * 1000 + frac, text: body });
      }
    } else lines.push({ text: raw.trim() });
  }
  while (lines.length && !lines[lines.length - 1].text) lines.pop();
  while (lines.length && !lines[0].text) lines.shift();
  if (!lines.some((l) => l.text)) return null;
  if (synced) {
    const timed = lines.filter((l) => l.timeMs !== undefined);
    timed.forEach((l) => { l.timeMs = Math.max(0, l.timeMs! - offset); });
    timed.sort((a, b) => a.timeMs! - b.timeMs!);
    return { lines: timed, synced: true, origin };
  }
  return { lines, synced: false, origin };
}

/** Индекс строки, которая должна быть выделена в данный момент. */
export function activeLine(lines: LyricLine[], positionMs: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((lines[mid].timeMs ?? 0) <= positionMs) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return found;
}
