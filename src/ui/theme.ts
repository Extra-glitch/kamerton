import { useColorScheme } from 'react-native';
import { useSettings } from '@/state/settings';

// Палитра «Хвоя и пион»: глубокий хвойный фон и один тёплый акцент,
// который не совпадает с фирменными цветами подключаемых сервисов.
export const dark = {
  bg: '#0E211D', raised: '#163029', sunken: '#0A1815', line: '#2A4A41',
  text: '#EAF2EC', muted: '#A3BDB3', faint: '#7C988D',
  accent: '#FFA9C6', onAccent: '#2B0F1C', accentSoft: '#3A2B33', warn: '#F2CB94', danger: '#FF9A94',
  coverTones: ['#1E4A3F', '#2C3F55', '#54364A', '#4B4A2C', '#2A5560', '#5A3C33'],
};
export const light: typeof dark = {
  bg: '#E6EFE8', raised: '#F5F9F5', sunken: '#D8E4DB', line: '#BCCFC3',
  text: '#10261F', muted: '#3F5A50', faint: '#5C766B',
  accent: '#AD1F58', onAccent: '#FFF5F8', accentSoft: '#F3D6E2', warn: '#7D520F', danger: '#A8241C',
  coverTones: ['#B9D4C6', '#BCCBDD', '#E2C6D4', '#DAD8B4', '#B5D6DC', '#E3CCBE'],
};
export type Colors = typeof dark;

export function useColors(): Colors {
  const pref = useSettings((s) => s.theme);
  const system = useColorScheme();
  return (pref === 'system' ? system : pref) === 'light' ? light : dark;
}
export function useIsLight(): boolean { return useColors() === light; }

export const FONT = { d8: 'Display-800', d6: 'Display-600', b4: 'Body-400', b5: 'Body-500', b7: 'Body-700' };

export const TYPE = {
  poster: { fontFamily: FONT.d8, fontSize: 112, lineHeight: 104 },
  h1: { fontFamily: FONT.d8, fontSize: 56, lineHeight: 56 },
  h2: { fontFamily: FONT.d8, fontSize: 38, lineHeight: 40 },
  h3: { fontFamily: FONT.d6, fontSize: 29, lineHeight: 32 },
  title: { fontFamily: FONT.b5, fontSize: 15.5, lineHeight: 21 },
  body: { fontFamily: FONT.b4, fontSize: 15.5, lineHeight: 23 },
  strong: { fontFamily: FONT.b5, fontSize: 14.5, lineHeight: 20 },
  small: { fontFamily: FONT.b4, fontSize: 13, lineHeight: 18 },
};
export type TypeName = keyof typeof TYPE;

export const SPACE = { page: 20, gap: 12, section: 38 };
/** Запас снизу под мини-плеер и панель разделов. */
export const BOTTOM_PAD = 170;
export const TAB_HEIGHT = 58;
