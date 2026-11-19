// Немного цветовой математики: смешивание, яркость и контраст по WCAG.

export type RGB = [number, number, number];

export function parseColor(c: string): RGB | null {
  const s = c.trim();
  let m = s.match(/^#([0-9a-f]{3})$/i);
  if (m) return m[1].split('').map((x) => parseInt(x + x, 16)) as RGB;
  m = s.match(/^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/i);
  if (m) return [0, 2, 4].map((i) => parseInt(m![1].slice(i, i + 2), 16)) as RGB;
  m = s.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  return null;
}

export const toHex = ([r, g, b]: RGB) => `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;

export function mix(a: string, b: string, t: number): string {
  const x = parseColor(a);
  const y = parseColor(b);
  if (!x || !y) return a;
  return toHex([0, 1, 2].map((i) => x[i] + (y[i] - x[i]) * t) as RGB);
}

export function alpha(c: string, a: number): string {
  const x = parseColor(c);
  return x ? `rgba(${x[0]},${x[1]},${x[2]},${a})` : c;
}

export function luminance(c: string): number {
  const x = parseColor(c);
  if (!x) return 0;
  const [r, g, b] = x.map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** Насыщенность в HSL, от 0 до 1. Серые обложки не годятся в акцент. */
export function saturation(c: string): number {
  const x = parseColor(c);
  if (!x) return 0;
  const [r, g, b] = x.map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return 0;
  return l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);
}

/** Осветляет или затемняет цвет, пока он не станет читаемым на фоне. */
export function readableOn(c: string, bg: string, ratio = 4.5): string {
  const towards = luminance(bg) < 0.3 ? '#ffffff' : '#000000';
  let out = c;
  for (let i = 1; i <= 20 && contrast(out, bg) < ratio; i++) out = mix(c, towards, i * 0.05);
  return out;
}

/** Текст поверх акцентной кнопки: тёмный на светлом и наоборот. */
export const textOn = (c: string, dark = '#1D0F1F', light = '#FFFFFF') => (contrast(c, dark) >= contrast(c, light) ? dark : light);
