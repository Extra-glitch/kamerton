// Определение версии трека по названию и по данным источника.
// Главное правило: оригинал никогда молча не заменяется на clean, ремикс, кавер или концерт.

import type { ExplicitState, RemoteTrack, VersionTag } from './types';
import { normalizeText, primaryArtist, tokens } from './text';

/** Фразы, значащие что-то только в скобках или после тире: песня может называться просто «Clean». */
const QUALIFIER_PHRASES: [string, VersionTag][] = [
  ['clean version', 'clean'], ['clean edit', 'clean'], ['clean', 'clean'], ['censored', 'clean'],
  ['edited version', 'clean'], ['edited', 'clean'], ['radio safe', 'clean'],
  ['цензурная версия', 'clean'], ['без мата', 'clean'], ['цензура', 'clean'],
  ['radio edit', 'radio_edit'], ['radio version', 'radio_edit'], ['radio mix', 'radio_edit'], ['радио версия', 'radio_edit'],
  ['explicit', 'explicit_marked'], ['explicit version', 'explicit_marked'], ['uncensored', 'explicit_marked'],
  ['dirty', 'explicit_marked'], ['dirty version', 'explicit_marked'], ['нецензурная версия', 'explicit_marked'], ['без цензуры', 'explicit_marked'],
  ['remix', 'remix'], ['rmx', 'remix'], ['mix', 'remix'], ['bootleg', 'remix'], ['flip', 'remix'], ['vip', 'remix'], ['ремикс', 'remix'],
  ['live', 'live'], ['concert', 'live'], ['unplugged', 'live'], ['концерт', 'live'], ['концертная', 'live'], ['живое', 'live'], ['живьем', 'live'],
  ['cover', 'cover'], ['covered by', 'cover'], ['tribute', 'cover'], ['кавер', 'cover'],
  ['karaoke', 'karaoke'], ['караоке', 'karaoke'], ['backing track', 'karaoke'], ['минус', 'karaoke'],
  ['instrumental', 'instrumental'], ['инструментал', 'instrumental'], ['инструментальная', 'instrumental'],
  ['acoustic', 'acoustic'], ['акустика', 'acoustic'], ['акустическая', 'acoustic'],
  ['sped up', 'sped_up'], ['speed up', 'sped_up'], ['ускоренная', 'sped_up'],
  ['slowed', 'slowed'], ['slowed reverb', 'slowed'], ['slowed down', 'slowed'], ['замедленная', 'slowed'],
  ['nightcore', 'nightcore'],
  ['remaster', 'remaster'], ['remastered', 'remaster'], ['ремастер', 'remaster'],
  ['demo', 'demo'], ['демо', 'demo'],
];

/** Эти слова уверенно указывают на версию даже в конце названия без скобок. */
const TAIL_PHRASES: [string, VersionTag][] = [
  ['remix', 'remix'], ['ремикс', 'remix'], ['karaoke', 'karaoke'], ['караоке', 'karaoke'],
  ['nightcore', 'nightcore'], ['sped up', 'sped_up'], ['slowed reverb', 'slowed'], ['slowed', 'slowed'],
  ['radio edit', 'radio_edit'], ['clean version', 'clean'], ['instrumental', 'instrumental'],
];

const LIVE_PREFIXES = ['live at', 'live in', 'live from', 'live on'];
const FEAT_PREFIXES = ['feat', 'ft', 'featuring', 'with', 'при участии', 'уч'];

/** Снятие скобочных частей и хвоста после тире: возвращает основу и уточнения. */
function splitQualifiers(title: string): { core: string; qualifiers: string[] } {
  const qualifiers: string[] = [];
  let core = title.replace(/[([{【]([^)\]}】]*)[)\]}】]/g, (whole, inner: string) => {
    qualifiers.push(inner);
    return ` \u0001${qualifiers.length - 1}\u0001 `;
  });
  const dash = core.split(/\s[-–—]\s/);
  if (dash.length > 1) {
    core = dash[0];
    qualifiers.push(...dash.slice(1));
  }
  return { core, qualifiers };
}

function phraseIn(text: string, phrase: string): boolean {
  return ` ${text} `.includes(` ${phrase} `);
}

function tagsOfQualifier(q: string): VersionTag[] {
  const norm = normalizeText(q);
  const found = new Set<VersionTag>();
  if (LIVE_PREFIXES.some((p) => norm.startsWith(p))) found.add('live');
  // «uncensored» и «нецензурная» не должны считаться цензурированной версией.
  const isUncensored = phraseIn(norm, 'uncensored') || norm.includes('нецензур') || phraseIn(norm, 'без цензуры');
  for (const [phrase, tag] of QUALIFIER_PHRASES) {
    if (!phraseIn(norm, phrase)) continue;
    if (tag === 'clean' && isUncensored) continue;
    // «live» внутри «(Live and Let Die)» не версия: требуем короткое уточнение или формат «live at».
    if (tag === 'live' && phrase === 'live' && tokens(q).length > 4) continue;
    if (tag === 'remix' && phrase === 'mix' && !/(mix)$/.test(norm)) continue;
    found.add(tag);
  }
  return [...found];
}

export interface ParsedTitle {
  coreTitle: string;
  versionTags: VersionTag[];
  featured: string[];
}

export function parseTitle(title: string): ParsedTitle {
  const { core, qualifiers } = splitQualifiers(title);
  const versionTags = new Set<VersionTag>();
  const featured: string[] = [];
  const kept = new Map<number, string>();
  qualifiers.forEach((q, i) => {
    const norm = normalizeText(q);
    const feat = FEAT_PREFIXES.find((p) => norm.startsWith(`${p} `));
    if (feat) {
      featured.push(q.replace(/^\s*[^\s]+\.?\s+/, '').trim());
      return;
    }
    const tags = tagsOfQualifier(q);
    if (tags.length) tags.forEach((t) => versionTags.add(t));
    else kept.set(i, q); // обычная часть названия, например «(I Can't Get No)»
  });

  let coreText = core.replace(/\u0001(\d+)\u0001/g, (_, n: string) => kept.get(Number(n)) ?? '');
  const featInline = coreText.match(/\s(?:feat\.?|ft\.?|featuring)\s(.+)$/i);
  if (featInline) {
    featured.push(featInline[1].trim());
    coreText = coreText.slice(0, featInline.index);
  }
  let norm = normalizeText(coreText);
  for (const [phrase, tag] of TAIL_PHRASES) {
    if (norm !== phrase && norm.endsWith(` ${phrase}`)) {
      versionTags.add(tag);
      norm = norm.slice(0, -phrase.length - 1).trim();
    }
  }
  for (const p of LIVE_PREFIXES) {
    const at = norm.indexOf(` ${p} `);
    if (at > 0) {
      versionTags.add('live');
      norm = norm.slice(0, at).trim();
    }
  }
  return { coreTitle: norm, versionTags: [...versionTags], featured };
}

/** Теги, которые делают запись другой версией песни. Ремастер оригиналом остаётся. */
const CONFLICTING: VersionTag[] = [
  'clean', 'radio_edit', 'remix', 'live', 'cover', 'karaoke', 'instrumental', 'acoustic', 'sped_up', 'slowed', 'nightcore', 'demo',
];

export function versionKey(tags: VersionTag[], explicit: ExplicitState): string {
  const set = new Set(tags.filter((t) => CONFLICTING.includes(t)));
  if (explicit === 'clean') set.add('clean');
  return [...set].sort().join('+');
}

export function versionConflicts(wanted: VersionTag[], wantedExplicit: ExplicitState, candidate: VersionTag[], candidateExplicit: ExplicitState): VersionTag[] {
  const a = new Set(versionKey(wanted, wantedExplicit).split('+').filter(Boolean));
  const b = versionKey(candidate, candidateExplicit).split('+').filter(Boolean) as VersionTag[];
  return b.filter((t) => !a.has(t));
}

export function resolveExplicit(flag: ExplicitState, tags: VersionTag[]): ExplicitState {
  if (flag === 'explicit' || flag === 'clean') return flag;
  if (tags.includes('clean')) return 'clean';
  if (tags.includes('explicit_marked')) return 'explicit';
  return flag;
}

export function canonicalKey(t: Pick<RemoteTrack, 'title' | 'artist' | 'explicit'>): string {
  const parsed = parseTitle(t.title);
  const artist = normalizeText(primaryArtist(t.artist));
  const title = parsed.coreTitle || normalizeText(t.title);
  return `${artist}|${title}|${versionKey(parsed.versionTags, resolveExplicit(t.explicit, parsed.versionTags))}`;
}

const TAG_NAMES: Record<VersionTag, string> = {
  clean: 'Цензурированная', radio_edit: 'Радиоверсия', explicit_marked: 'Без цензуры', remix: 'Ремикс', live: 'Концертная',
  cover: 'Кавер', karaoke: 'Караоке', instrumental: 'Инструментал', acoustic: 'Акустика', sped_up: 'Ускоренная',
  slowed: 'Замедленная', nightcore: 'Nightcore', remaster: 'Ремастер', demo: 'Демо',
};

export function versionLabel(tag: VersionTag): string {
  return TAG_NAMES[tag];
}

/** Подпись для интерфейса: говорит только то, что действительно известно. */
export function explicitLabel(state: ExplicitState, tags: VersionTag[] = []): string {
  if (state === 'clean') return tags.includes('radio_edit') ? 'Радиоверсия, возможна цензура' : 'Цензурированная версия';
  if (tags.includes('radio_edit')) return 'Радиоверсия, цензура возможна';
  if (state === 'explicit') return 'Оригинал без цензуры';
  if (state === 'not_explicit') return 'Оригинал, ненормативной лексики нет';
  return 'Версия не указана источником';
}
