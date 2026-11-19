// Варианты написания запроса: кириллица, латиница и транслитерация.
// «Моргенштерн» ищется и как «morgenshtern», «dead blonde» и как «деад блонде».

import { normalizeText, transliterate } from '@/core/text';

const CYR = /[а-яё]/i;
const LAT = /[a-z]/i;

// Обратная транслитерация: сначала длинные сочетания букв.
const CYR_FROM_LATIN: [string, string][] = [
  ['shch', 'щ'], ['sch', 'щ'], ['zh', 'ж'], ['kh', 'х'], ['ts', 'ц'], ['ch', 'ч'], ['sh', 'ш'], ['yu', 'ю'], ['ya', 'я'], ['yo', 'ё'], ['ye', 'е'],
  ['a', 'а'], ['b', 'б'], ['c', 'к'], ['d', 'д'], ['e', 'е'], ['f', 'ф'], ['g', 'г'], ['h', 'х'], ['i', 'и'], ['j', 'дж'], ['k', 'к'], ['l', 'л'],
  ['m', 'м'], ['n', 'н'], ['o', 'о'], ['p', 'п'], ['q', 'к'], ['r', 'р'], ['s', 'с'], ['t', 'т'], ['u', 'у'], ['v', 'в'], ['w', 'в'], ['x', 'кс'], ['y', 'й'], ['z', 'з'],
];

export function latinToCyrillic(input: string): string {
  const s = normalizeText(input);
  let out = '';
  for (let i = 0; i < s.length;) {
    const hit = CYR_FROM_LATIN.find(([lat]) => s.startsWith(lat, i));
    if (hit) { out += hit[1]; i += hit[0].length; } else { out += s[i]; i++; }
  }
  return out;
}

/** Исходный запрос и его транслитерация. Повторы и пустые варианты убираются. */
export function queryVariants(q: string, extra: string[] = []): string[] {
  const base = q.trim().replace(/\s+/g, ' ');
  if (!base) return [];
  const list = [base, ...extra];
  if (CYR.test(base)) list.push(transliterate(base));
  else if (LAT.test(base) && base.length >= 3) list.push(latinToCyrillic(base));
  const seen = new Set<string>();
  return list.filter((v) => { const k = normalizeText(v); if (!k || seen.has(k)) return false; seen.add(k); return true; });
}
