// Живой фон из цветов обложки: три мягких пятна, которые медленно плывут, пока играет музыка.

import { useEffect, useId } from 'react';
import { Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { cancelAnimation, Easing, FadeIn, FadeOut, interpolate, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming, type SharedValue } from 'react-native-reanimated';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { displayCover } from '@/sources/subsonic';
import { usePlayer } from '@/state/app';
import { useSettings } from '@/state/settings';
import { useColors, useTint } from './theme';

/** Разрешено ли сейчас фоновое движение: настройка приложения и системная «Уменьшить движение». */
export function useMotion(): boolean {
  const reduce = useReducedMotion();
  const allowed = useSettings((s) => s.animations);
  return allowed && !reduce;
}

/** Анимация появления, только если движение разрешено. С отключёнными системными анимациями Reanimated может оставить вид невидимым. */
export function useEntering<T>(anim: T): T | undefined {
  return useMotion() ? anim : undefined;
}

const SPOTS = [
  { x: -0.38, y: -0.3, dx: 0.06, dy: 0.04 },
  { x: 0.42, y: 0.12, dx: -0.05, dy: 0.06 },
  { x: -0.1, y: 0.62, dx: 0.05, dy: -0.05 },
];

function Blob({ color, i, size, t, w, h, strength }: { color: string; i: number; size: number; t: SharedValue<number>; w: number; h: number; strength: number }) {
  const id = useId().replace(/:/g, '');
  const motion = useMotion();
  const p = SPOTS[i];
  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(t.value, [0, 1], [-1, 1]) * p.dx * w },
      { translateY: interpolate(t.value, [0, 1], [-1, 1]) * p.dy * h },
      { scale: interpolate(t.value, [0, 0.5, 1], [1, 1.12, 1]) },
    ],
  }));
  return (
    <Animated.View entering={motion ? FadeIn.duration(900) : undefined} exiting={motion ? FadeOut.duration(900) : undefined} style={[{ position: 'absolute', width: size, height: size, left: w / 2 + p.x * w - size / 2, top: h / 2 + p.y * h - size / 2 }, style]}>
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id={`a${id}`} cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={color} stopOpacity={0.75 * strength} />
            <Stop offset="0.55" stopColor={color} stopOpacity={0.28 * strength} />
            <Stop offset="1" stopColor={color} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={size / 2} fill={`url(#a${id})`} />
      </Svg>
    </Animated.View>
  );
}

export function Ambient({ animate = false, strength = 1 }: { animate?: boolean; strength?: number }) {
  const c = useColors();
  const { width: w, height: h } = useWindowDimensions();
  const motion = useMotion();
  const playing = usePlayer((p) => p.playing);
  const run = animate && motion && playing;
  const t = useSharedValue(0.5);
  useEffect(() => {
    if (run) t.value = withRepeat(withTiming(t.value > 0.5 ? 0 : 1, { duration: 14000, easing: Easing.inOut(Easing.sin) }), -1, true);
    else cancelAnimation(t);
  }, [run, t]);
  const size = Math.max(w, h) * 1.05;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: c.bg, overflow: 'hidden' }]}>
      {c.ambient.slice(0, 3).map((color, i) => <Blob key={`${i}${color}`} color={color} i={i} size={size} t={t} w={w} h={h} strength={strength} />)}
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
