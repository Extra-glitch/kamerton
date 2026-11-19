// Фон из цветов обложки и общие настройки движения.

import { LinearGradient } from 'expo-linear-gradient';
import { useEffect } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { displayCover } from '@/sources/subsonic';
import { usePlayer } from '@/state/app';
import { alpha } from './color';
import { useSettings } from '@/state/settings';
import { useColors, useTint } from './theme';

/** Разрешено ли сейчас фоновое движение: настройка приложения и системная «Уменьшить движение». */
export function useMotion(): boolean {
  const reduce = useReducedMotion();
  const allowed = useSettings((s) => s.animations);
  return allowed && !reduce;
}

/**
 * Фон из цветов обложки: два мягких градиента поверх основного цвета.
 * Раньше здесь были большие векторные пятна с движением: на телефонах они тормозили,
 * поэтому теперь фон рисуется нативными градиентами и не анимируется.
 */
export function Ambient({ strength = 1 }: { animate?: boolean; strength?: number }) {
  const c = useColors();
  const a = alpha(c.ambient[0] ?? c.accent, (c.blur === 'dark' ? 0.55 : 0.5) * strength);
  const b = alpha(c.ambient[1] ?? c.accent, (c.blur === 'dark' ? 0.42 : 0.4) * strength);
  const d = alpha(c.ambient[2] ?? c.accent, (c.blur === 'dark' ? 0.3 : 0.3) * strength);
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: c.bg }]}>
      <LinearGradient colors={[a, alpha(c.ambient[0] ?? c.accent, 0)]} start={{ x: 0, y: 0 }} end={{ x: 0.75, y: 0.55 }} style={StyleSheet.absoluteFill} />
      <LinearGradient colors={[alpha(c.ambient[1] ?? c.accent, 0), b]} start={{ x: 0.2, y: 0.35 }} end={{ x: 1, y: 0.75 }} style={StyleSheet.absoluteFill} />
      <LinearGradient colors={[alpha(c.ambient[2] ?? c.accent, 0), d]} start={{ x: 0.5, y: 0.6 }} end={{ x: 0.2, y: 1 }} style={StyleSheet.absoluteFill} />
    </View>
  );
}

type Palette = { dominant?: string; vibrant?: string; darkVibrant?: string; lightVibrant?: string; muted?: string; darkMuted?: string; lightMuted?: string; average?: string; background?: string; primary?: string; secondary?: string; detail?: string };

/** Берёт цвета обложки текущего трека. Без сети или при ошибке остаётся своя гамма. */
export function ArtworkTint() {
  const cover = usePlayer((p) => p.current?.coverUrl ?? p.source?.coverUrl ?? null);
  const enabled = useSettings((s) => s.coverColors);
  useEffect(() => {
    const uri = displayCover(cover ?? undefined);
    if (!enabled || !uri) { useTint.setState({ key: null, colors: null }); return; }
    if (useTint.getState().key === uri) return;
    let alive = true;
    (async () => {
      try {
        const mod = await import('react-native-image-colors');
        const r = (await mod.getColors(uri, { fallback: '#000000', cache: true, key: uri.slice(-480), quality: 'low', pixelSpacing: 6 })) as Palette;
        const list = Platform.OS === 'ios'
          ? [r.primary, r.secondary, r.detail, r.background]
          : [r.vibrant, r.darkVibrant, r.lightVibrant, r.dominant, r.muted, r.darkMuted];
        const colors = [...new Set(list.filter((x): x is string => !!x && x !== '#000000'))];
        if (alive && colors.length) useTint.setState({ key: uri, colors });
      } catch { if (alive) useTint.setState({ key: uri, colors: null }); }
    })();
    return () => { alive = false; };
  }, [cover, enabled]);
  return null;
}
