// Насколько результат поиска соответствует запросу. Свободные каталоги часто возвращают
// случайные совпадения по одному слову, поэтому их результаты отбираются по этой оценке.

import { normalizeText, similarity, splitArtists, tokens, transliterate } from './text';

/** Оценка от 0 до 1: совпадение запроса с исполнителем, названием или их сочетанием. */
export function relevance(q: string, t: { title: string; artist: string; album?: string }): number {
  const nq = normalizeText(q);
  if (!nq) return 0;
  const artists = splitArtists(t.artist);
  const variants = [t.title, t.artist, ...artists, `${t.artist} ${t.title}`, `${t.title} ${t.artist}`];
  let best = 0;
  for (const v of variants) best = Math.max(best, similarity(q, v));
  // Все слова запроса встречаются в карточке трека, с учётом транслитерации.
  const qt = tokens(q).map((w) => transliterate(w));
  const hay = new Set(tokens(`${t.artist} ${t.title} ${t.album ?? ''}`).map((w) => transliterate(w)));
  const covered = qt.filter((w) => hay.has(w) || [...hay].some((h) => w.length >= 4 && h.startsWith(w))).length;
  if (qt.length && covered === qt.length) best = Math.max(best, qt.length > 1 ? 0.97 : 0.9);
  return best;
}

/** Порог, ниже которого результат свободного каталога считается случайным. */
export const RELEVANT = 0.86;

/** Имя исполнителя совпадает с запросом настолько, что это, скорее всего, он. */
export const isArtistMatch = (q: string, name: string) => similarity(q, name) >= 0.92;
