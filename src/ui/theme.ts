import { useColorScheme } from 'react-native';
import { create } from 'zustand';
import { useSettings } from '@/state/settings';
import { alpha, mix, readableOn, saturation, textOn } from './color';

// «Резонанс»: ночной фиолетовый фон, стеклянные панели и цвет, который приходит с обложки
// играющего трека. Когда ничего не играет, фон держит собственная пионово-сиреневая гамма.
export const dark = {
  bg: '#140F1F',
  /** Стекло поверх фона: заливка, обводка и блик сверху. */
  glass: 'rgba(255,255,255,0.075)', glassStrong: 'rgba(28,21,42,0.86)', stroke: 'rgba(255,255,255,0.13)', shine: 'rgba(255,255,255,0.22)',
  line: 'rgba(255,255,255,0.10)', raised: '#231B34', sunken: 'rgba(0,0,0,0.24)', scrim: 'rgba(8,5,14,0.62)',
  text: '#F6F2FC', muted: '#C0B7D3', faint: '#8F86A3',
  accent: '#FF9EC4', onAccent: '#2A0E1E', accentSoft: 'rgba(255,158,196,0.16)',
  ok: '#94E6B9', warn: '#FFD08A', danger: '#FF9191',
  /** Пятна фона по умолчанию. */
  ambient: ['#6F3A9C', '#24508F', '#A8416C'],
  blur: 'dark' as 'dark' | 'light',
  coverTones: [['#6D3B8F', '#E07AA6'], ['#244C86', '#56C1C9'], ['#7A2E4C', '#F2A15F'], ['#2F5C4A', '#B8E07A'], ['#3B2F86', '#9A8CFF'], ['#86422F', '#FFC46B']] as [string, string][],
};
export const light: typeof dark = {
  bg: '#F1ECF7',
  glass: 'rgba(255,255,255,0.62)', glassStrong: 'rgba(250,247,253,0.94)', stroke: 'rgba(48,24,82,0.10)', shine: 'rgba(255,255,255,0.9)',
  line: 'rgba(48,24,82,0.10)', raised: '#FFFFFF', sunken: 'rgba(48,24,82,0.06)', scrim: 'rgba(40,24,60,0.32)',
  text: '#1C1429', muted: '#564B6B', faint: '#7A708D',
  accent: '#B8195A', onAccent: '#FFF6FA', accentSoft: 'rgba(184,25,90,0.12)',
  ok: '#1E7A4C', warn: '#8A5A0B', danger: '#B3261E',
  ambient: ['#D6B6F2', '#B7CBF6', '#F6BFD5'],
  blur: 'light',
  coverTones: [['#C9A6E6', '#F4B6CF'], ['#A9C4F2', '#A8E3E6'], ['#F2B5C6', '#FAD3A6'], ['#B9DCC6', '#E2F0B0'], ['#C2B9F4', '#D9D2FF'], ['#F2C4AE', '#FFE2A6']] as [string, string][],
};
export type Colors = typeof dark;

/** Цвета текущей обложки. Заполняются из src/ui/ambient.tsx. */
export const useTint = create<{ key: string | null; colors: string[] | null }>(() => ({ key: null, colors: null }));

const cache = new WeakMap<Colors, Map<string, Colors>>();
const isLight = (c: Colors) => c.blur === 'light';

/** Палитра с акцентом из обложки: только если цвет достаточно насыщенный и читаемый. */
export function tinted(base: Colors, colors: string[] | null): Colors {
  if (!colors?.length) return base;
  const k = colors.join();
  let m = cache.get(base);
  if (!m) { m = new Map(); cache.set(base, m); }
  const hit = m.get(k);
  if (hit) return hit;
  const vivid = [...colors].sort((a, b) => saturation(b) - saturation(a))[0];
  let out: Colors = { ...base, ambient: colors.slice(0, 3).map((c) => (isLight(base) ? mix(c, '#ffffff', 0.45) : mix(c, '#000000', 0.15))) };
  if (saturation(vivid) > 0.28) {
    const accent = readableOn(isLight(base) ? mix(vivid, '#000000', 0.2) : mix(vivid, '#ffffff', 0.25), base.bg, 4.5);
    out = { ...out, accent, onAccent: textOn(accent), accentSoft: alpha(accent, isLight(base) ? 0.12 : 0.16) };
  }
  if (m.size > 40) m.clear();
  m.set(k, out);
  return out;
}

export function useColors(): Colors {
  const pref = useSettings((s) => s.theme);
  const useCover = useSettings((s) => s.coverColors);
  const tint = useTint((t) => t.colors);
  const system = useColorScheme();
  const base = (pref === 'system' ? system : pref) === 'light' ? light : dark;
  return useCover ? tinted(base, tint) : base;
}
export function useIsLight(): boolean { return useColors().blur === 'light'; }

// Unbounded — широкий геометрический гротеск с кириллицей для заголовков, Golos Text — для текста.
export const FONT = { d8: 'Display-700', d6: 'Display-500', b4: 'Body-400', b5: 'Body-500', b7: 'Body-700' };
/** Крупное название песни: узкий жирный шрифт, чтобы длинные названия не вылезали за край. */
export const SONG_TITLE = { fontFamily: 'Body-700', fontSize: 26, lineHeight: 32 };

export const TYPE = {
  poster: { fontFamily: FONT.d8, fontSize: 40, lineHeight: 46, letterSpacing: -0.6 },
  h1: { fontFamily: FONT.d8, fontSize: 28, lineHeight: 34, letterSpacing: -0.4 },
  // Заголовки разделов набраны узким Golos: широкий Unbounded в них не помещался на маленьких экранах.
  h2: { fontFamily: FONT.b7, fontSize: 21, lineHeight: 27 },
  h3: { fontFamily: FONT.b7, fontSize: 17, lineHeight: 23 },
  title: { fontFamily: FONT.b5, fontSize: 15.5, lineHeight: 21 },
  body: { fontFamily: FONT.b4, fontSize: 15.5, lineHeight: 23 },
  strong: { fontFamily: FONT.b5, fontSize: 14.5, lineHeight: 20 },
  small: { fontFamily: FONT.b4, fontSize: 13, lineHeight: 18 },
};
export type TypeName = keyof typeof TYPE;

export const RADIUS = { card: 22, cover: 12, pill: 999 };
export const SPACE = { page: 18, gap: 12, section: 34 };
/** Нижняя стеклянная панель: высота разделов и мини-плеера. */
export const TAB_HEIGHT = 62;
export const MINI_HEIGHT = 64;
/** Запас снизу под мини-плеер и панель разделов. */
export const BOTTOM_PAD = 190;
