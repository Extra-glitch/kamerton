// Нормализация текста и сравнение строк. Регулярные выражения намеренно простые:
// \b в JavaScript не понимает кириллицу, поэтому работаем со словами-токенами.

const LATIN_FROM_CYR: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l',
  м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch',
  ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

/** Нижний регистр, NFKC, ё→е, без диакритики. Кириллическая «й» сохраняется. */
export function foldCase(input: string): string {
  return input
    .normalize('NFKC')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .normalize('NFD')
    .replace(/й/g, 'й')
    .replace(/[̀-ͯ]/g, '')
    .normalize('NFC');
}

/** Разбивает строку на слова из латиницы, кириллицы и цифр. */
export function tokens(input: string): string[] {
  return foldCase(input)
    .replace(/&/g, ' and ')
    .split(/[^a-z0-9а-я]+/)
    .filter(Boolean);
}

export function normalizeText(input: string): string {
  return tokens(input).join(' ');
}

export function transliterate(input: string): string {
  let out = '';
  for (const ch of normalizeText(input)) out += LATIN_FROM_CYR[ch] ?? ch;
  return out;
}

export function jaroWinkler(a: string, b: string): number {
  if (a === b) return a.length ? 1 : 0;
  if (!a.length || !b.length) return 0;
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aHit = new Array<boolean>(a.length).fill(false);
  const bHit = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const from = Math.max(0, i - range);
    const to = Math.min(i + range + 1, b.length);
    for (let j = from; j < to; j++) {
      if (bHit[j] || a[i] !== b[j]) continue;
      aHit[i] = true;
      bHit[j] = true;
      matches++;
      break;
    }
  }
  if (!matches) return 0;
  let k = 0;
  let transpositions = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aHit[i]) continue;
    while (!bHit[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  const m = matches;
  const jaro = (m / a.length + m / b.length + (m - transpositions / 2) / m) / 3;
  let prefix = 0;
  while (prefix < 4 && prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

/** Сходство с учётом транслитерации: «Кино» и «Kino» считаются одним и тем же. */
export function similarity(a: string, b: string): number {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (!na || !nb) return 0;
  return Math.max(jaroWinkler(na, nb), jaroWinkler(transliterate(a), transliterate(b)));
}

const ARTIST_SPLIT = /\s*(?:,|;|\s&\s|\s\/\s|\sx\s|\sи\s|\bfeat\.?\s|\bft\.?\s|\bfeaturing\s|при участии\s|\bvs\.?\s)\s*/i;

export function splitArtists(input: string): string[] {
  return input
    .split(ARTIST_SPLIT)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function primaryArtist(input: string): string {
  return splitArtists(input)[0] ?? input.trim();
}

export function formatDuration(sec?: number | null): string {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return '';
  const total = Math.round(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  return b === 1 ? one : many;
}
