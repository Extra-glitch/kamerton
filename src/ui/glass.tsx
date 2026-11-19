// Стекло. Настоящее размытие на Android работает только для панелей поверх всего приложения
// (нижняя панель, меню, уведомления): им нужен «источник» — BlurTargetView со всем содержимым.
// Внутри экранов стекло рисуется полупрозрачной заливкой с бликом: так не размывается само себя.

import { BlurView } from 'expo-blur';
import { createContext, useContext, type ComponentRef, type ReactNode, type RefObject } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSettings } from '@/state/settings';
import { RADIUS, useColors } from './theme';

export type BlurTarget = RefObject<ComponentRef<typeof View> | null>;
// До Android 12 настоящего размытия нет: там панели делаются почти непрозрачными, чтобы текст читался.
const OLD_ANDROID = Platform.OS === 'android' && Number(Platform.Version) < 31;

export const BlurTargetContext = createContext<BlurTarget | null>(null);

export function Glass({ children, style, radius = RADIUS.card, floating, solid, intensity = 48, testID }: { children?: ReactNode; style?: StyleProp<ViewStyle>; radius?: number; floating?: boolean; solid?: boolean; intensity?: number; testID?: string }) {
  const c = useColors();
  const target = useContext(BlurTargetContext);
  const blurOn = useSettings((x) => x.glassBlur) && !OLD_ANDROID;
  const frame = { borderRadius: radius, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: c.stroke, overflow: 'hidden' as const };
  if (floating) {
    return (
      <View testID={testID} style={[frame, { backgroundColor: solid || !blurOn ? c.glassStrong : 'transparent' }, style]}>
        {/* Размытие пересчитывается на каждом кадре прокрутки, поэтому по умолчанию выключено (Настройки → Размытие). */}
        {blurOn ? <BlurView style={StyleSheet.absoluteFill} intensity={intensity} tint={c.blur} blurMethod="dimezisBlurViewSdk31Plus" blurReductionFactor={3} blurTarget={target ?? undefined} /> : null}
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: c.glass }]} />
        <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: radius / 2, right: radius / 2, height: StyleSheet.hairlineWidth * 2, backgroundColor: c.shine }} />
        {children}
      </View>
    );
  }
  return (
    <View testID={testID} style={[frame, { backgroundColor: c.glass }, style]}>
      <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: radius / 2, right: radius / 2, height: StyleSheet.hairlineWidth * 2, backgroundColor: c.shine }} />
      {children}
    </View>
  );
}
