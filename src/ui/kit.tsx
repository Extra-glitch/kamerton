import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View, type PressableProps, type StyleProp, type TextInputProps, type TextProps, type TextStyle, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { displayCover } from '@/sources/subsonic';
import { Ambient } from './ambient';
import { Glass } from './glass';
import { Icon, type IconName } from './icons';
import { useVideoInset } from './video';
import { BOTTOM_PAD, RADIUS, SPACE, TYPE, useColors, type TypeName } from './theme';

type Tone = 'text' | 'muted' | 'faint' | 'accent' | 'warn' | 'danger' | 'onAccent' | 'ok';

export function T({ v = 'body', c, style, ...rest }: TextProps & { v?: TypeName; c?: Tone }) {
  const col = useColors();
  return <Text {...rest} style={[TYPE[v], { color: col[c ?? 'text'] }, style as StyleProp<TextStyle>]} />;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** Нажимаемая область, которая слегка «проседает» под пальцем. */
export function Press({ style, children, scaleTo = 0.97, ...rest }: PressableProps & { style?: StyleProp<ViewStyle>; scaleTo?: number; children?: ReactNode }) {
  const k = useSharedValue(1);
  const a = useAnimatedStyle(() => ({ transform: [{ scale: k.value }] }));
  return (
    <AnimatedPressable {...rest} onPressIn={(e) => { k.value = withTiming(scaleTo, { duration: 90 }); rest.onPressIn?.(e); }} onPressOut={(e) => { k.value = withTiming(1, { duration: 160 }); rest.onPressOut?.(e); }} style={[style, a]}>
      {children}
    </AnimatedPressable>
  );
}

/** Отступ снизу под нижнюю панель и, если играет видео, под его панель. */
export function useBottomPad(): number {
  return BOTTOM_PAD + useVideoInset();
}

export function Screen({ children, title, back = true, right, scroll = true, ambient = true, sub }: { children: ReactNode; title?: string; back?: boolean; right?: ReactNode; scroll?: boolean; onRefresh?: () => void; ambient?: boolean; sub?: string }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const pad = useBottomPad();
  const head = back || right ? (
    <View style={[s.head, { paddingTop: insets.top + 6 }]}>
      {back ? <RoundBtn name="back" label="Назад" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} /> : null}
      <View style={{ flex: 1 }} />
      {right}
    </View>
  ) : <View style={{ height: insets.top + 14 }} />;
  const heading = title ? <View style={{ marginBottom: 18, marginTop: 4 }}><T v="h1" accessibilityRole="header" numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.7}>{title}</T>{sub ? <T c="muted" style={{ marginTop: 6 }}>{sub}</T> : null}</View> : null;
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      {ambient ? <Ambient strength={0.75} /> : null}
      {head}
      {scroll ? (
        <ScrollView contentContainerStyle={{ paddingHorizontal: SPACE.page, paddingBottom: pad }} keyboardShouldPersistTaps="handled">{heading}{children}</ScrollView>
      ) : <View style={{ flex: 1, paddingHorizontal: SPACE.page }}>{heading}{children}</View>}
    </View>
  );
}

export function IconBtn({ name, label, onPress, color, size = 24, active, disabled, testID }: { name: IconName; label: string; onPress?: () => void; color?: string; size?: number; active?: boolean; disabled?: boolean; testID?: string }) {
  const c = useColors();
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: active, disabled }} disabled={disabled} onPress={onPress} hitSlop={6}
      style={({ pressed }) => [s.iconBtn, { opacity: disabled ? 0.35 : pressed ? 0.55 : 1 }]}>
      <Icon name={name} size={size} color={color ?? (active ? c.accent : c.text)} />
    </Pressable>
  );
}

/** Круглая стеклянная кнопка: «назад», «свернуть» и действия в шапке. */
export function RoundBtn({ name, label, onPress, testID, active }: { name: IconName; label: string; onPress?: () => void; testID?: string; active?: boolean }) {
  const c = useColors();
  return (
    <Press testID={testID} accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={6} scaleTo={0.9}>
      <Glass radius={22} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><Icon name={name} size={22} color={active ? c.accent : c.text} /></Glass>
    </Press>
  );
}

export function Btn({ label, onPress, kind = 'solid', icon, disabled, busy, style, testID }: { label: string; onPress?: () => void; kind?: 'solid' | 'line' | 'quiet'; icon?: IconName; disabled?: boolean; busy?: boolean; style?: StyleProp<ViewStyle>; testID?: string }) {
  const c = useColors();
  const fg = kind === 'solid' ? c.onAccent : kind === 'quiet' ? c.accent : c.text;
  const inner = (
    <>
      {busy ? <ActivityIndicator size="small" color={fg} /> : icon ? <Icon name={icon} size={20} color={fg} /> : null}
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={[TYPE.strong, { color: fg, fontFamily: 'Body-700', flexShrink: 1 }]}>{label}</Text>
    </>
  );
  return (
    <Press testID={testID} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!(disabled || busy) }} disabled={disabled || busy} onPress={onPress} style={[{ opacity: disabled ? 0.4 : 1 }, style]}>
      {kind === 'line'
        ? <Glass radius={RADIUS.pill} style={s.btn}>{inner}</Glass>
        : <View style={[s.btn, kind === 'solid' && { backgroundColor: c.accent }, kind === 'quiet' && { paddingHorizontal: 2, alignSelf: 'flex-start' }]}>{inner}</View>}
    </Press>
  );
}

export function Chip({ label, on, onPress, testID, icon }: { label: string; on?: boolean; onPress?: () => void; testID?: string; icon?: IconName }) {
  const c = useColors();
  return (
    <Press testID={testID} accessibilityRole="button" accessibilityState={{ selected: !!on }} onPress={onPress} scaleTo={0.94}>
      <View style={[s.chip, { borderColor: on ? c.accent : c.stroke, backgroundColor: on ? c.accent : c.glass }]}>
        {icon ? <Icon name={icon} size={16} color={on ? c.onAccent : c.text} /> : null}
        <Text style={[TYPE.strong, { color: on ? c.onAccent : c.text }]}>{label}</Text>
      </View>
    </Press>
  );
}

/** Маленькая плашка состояния: «целиком», «фрагмент», «E». */
export function Badge({ label, tone = 'muted', solid }: { label: string; tone?: Tone; solid?: boolean }) {
  const c = useColors();
  const col = c[tone];
  return (
    <View style={{ paddingHorizontal: 6, height: 18, borderRadius: 5, justifyContent: 'center', backgroundColor: solid ? col : 'transparent', borderWidth: solid ? 0 : 1, borderColor: col }}>
      <Text allowFontScaling={false} style={{ fontFamily: 'Body-700', fontSize: 10.5, lineHeight: 14, color: solid ? c.bg : col }}>{label}</Text>
    </View>
  );
}

function hash(t: string) { let h = 0; for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0; return Math.abs(h); }

/** Обложка. Если её нет, рисуем градиент с инициалами, а не серую заглушку. */
export function Cover({ uri: stored, title, size, radius = RADIUS.cover, style }: { uri?: string; title: string; size: number | '100%'; radius?: number; style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  const uri = displayCover(stored);
  const [failed, setFailed] = useState(false);
  const box = { width: size, aspectRatio: 1, borderRadius: radius, overflow: 'hidden' as const };
  if (uri && !failed) return <Image source={uri} style={[box as never, { backgroundColor: c.glass }, style as never]} contentFit="cover" transition={160} recyclingKey={uri} onError={() => setFailed(true)} accessibilityIgnoresInvertColors />;
  const [a, b] = c.coverTones[hash(title) % c.coverTones.length];
  const letters = title.trim().split(/\s+/).slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join('') || '♪';
  const n = typeof size === 'number' ? size : 320;
  return (
    <View style={[box, style]}>
      <LinearGradient colors={[a, b]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[StyleSheet.absoluteFill, { justifyContent: 'flex-end', padding: n * 0.1 }]}>
        <Text allowFontScaling={false} numberOfLines={1} style={{ fontFamily: 'Display-700', fontSize: n * 0.26, lineHeight: n * 0.32, color: '#ffffff', opacity: 0.92 }}>{letters}</Text>
      </LinearGradient>
    </View>
  );
}

export function Section({ title, note, action, children }: { title: string; note?: string; action?: { label: string; onPress: () => void }; children: ReactNode }) {
  return (
    <View style={{ marginTop: SPACE.section }}>
      <View style={s.sectionHead}>
        <T v="h2" style={{ flex: 1 }} accessibilityRole="header">{title}</T>
        {action ? <Pressable onPress={action.onPress} hitSlop={10} accessibilityRole="button"><T v="strong" c="accent">{action.label}</T></Pressable> : null}
      </View>
      {note ? <T v="small" c="muted" style={{ marginTop: 3 }}>{note}</T> : null}
      <View style={{ marginTop: 12 }}>{children}</View>
    </View>
  );
}

export function Shelf({ children }: { children: ReactNode }) {
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -SPACE.page }} contentContainerStyle={{ paddingHorizontal: SPACE.page, gap: 14 }}>{children}</ScrollView>;
}

export function Empty({ title, text, action, onAction }: { title: string; text: string; action?: string; onAction?: () => void }) {
  return (
    <Glass style={{ padding: 20, marginVertical: 12 }}>
      <T v="h3">{title}</T>
      <T c="muted" style={{ marginTop: 6, maxWidth: 420 }}>{text}</T>
      {action ? <Btn label={action} onPress={onAction} style={{ marginTop: 16, alignSelf: 'flex-start' }} /> : null}
    </Glass>
  );
}

export function Notice({ text, tone = 'muted', title }: { text: string; tone?: 'muted' | 'warn' | 'danger' | 'ok'; title?: string }) {
  const c = useColors();
  return (
    <Glass radius={16} style={{ flexDirection: 'row', gap: 10, paddingVertical: 11, paddingHorizontal: 14, marginVertical: 8 }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, marginTop: 6, backgroundColor: tone === 'muted' ? c.faint : c[tone] }} />
      <View style={{ flex: 1 }}>
        {title ? <T v="strong">{title}</T> : null}
        <T v="small" c={tone === 'muted' ? 'muted' : 'text'}>{text}</T>
      </View>
    </Glass>
  );
}

export function Loading({ label }: { label?: string }) {
  const c = useColors();
  return <View style={{ paddingVertical: 30, flexDirection: 'row', alignItems: 'center', gap: 12 }}><ActivityIndicator color={c.accent} />{label ? <T v="small" c="muted" style={{ flex: 1 }}>{label}</T> : null}</View>;
}

export function Row({ title, sub, onPress, right, icon, danger, testID }: { title: string; sub?: string; onPress?: () => void; right?: ReactNode; icon?: IconName; danger?: boolean; testID?: string }) {
  const c = useColors();
  return (
    <Pressable testID={testID} disabled={!onPress} onPress={onPress} accessibilityRole={onPress ? 'button' : undefined} style={({ pressed }) => [s.row, { opacity: pressed ? 0.6 : 1 }]}>
      {icon ? <View style={[s.rowIcon, { backgroundColor: danger ? c.accentSoft : c.glass, borderColor: c.stroke }]}><Icon name={icon} size={20} color={danger ? c.danger : c.text} /></View> : null}
      <View style={{ flex: 1 }}>
        <T v="title" c={danger ? 'danger' : 'text'}>{title}</T>
        {sub ? <T v="small" c="muted" style={{ marginTop: 1 }}>{sub}</T> : null}
      </View>
      {right}
    </Pressable>
  );
}

export function SwitchRow({ title, sub, value, onChange }: { title: string; sub?: string; value: boolean; onChange: (v: boolean) => void }) {
  const c = useColors();
  return <Row title={title} sub={sub} right={<Switch accessibilityLabel={title} value={value} onValueChange={onChange} trackColor={{ true: c.accent, false: c.line }} thumbColor={value ? c.onAccent : c.muted} />} />;
}

export function Choice<V extends string>({ value, options, onChange }: { value: V; options: { value: V; label: string }[]; onChange: (v: V) => void }) {
  return <View style={s.wrap}>{options.map((o) => <Chip key={o.value} label={o.label} on={o.value === value} onPress={() => onChange(o.value)} />)}</View>;
}

export function Field({ label, hint, style, icon, ...rest }: TextInputProps & { label?: string; hint?: string; icon?: IconName }) {
  const c = useColors();
  const [focus, setFocus] = useState(false);
  return (
    <View style={{ marginBottom: 14 }}>
      {label ? <T v="strong" style={{ marginBottom: 6 }}>{label}</T> : null}
      <View style={[s.field, { backgroundColor: c.glass, borderColor: focus ? c.accent : c.stroke }]}>
        {icon ? <Icon name={icon} size={20} color={c.faint} /> : null}
        <TextInput accessibilityLabel={label ?? rest.placeholder} placeholderTextColor={c.faint} selectionColor={c.accent} {...rest}
          onFocus={(e) => { setFocus(true); rest.onFocus?.(e); }} onBlur={(e) => { setFocus(false); rest.onBlur?.(e); }}
          style={[TYPE.body, { color: c.text, flex: 1, paddingVertical: 12 }, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as never) : null, style]} />
      </View>
      {hint ? <T v="small" c="muted" style={{ marginTop: 5 }}>{hint}</T> : null}
    </View>
  );
}

export const s = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACE.page - 4, paddingBottom: 6, gap: 8 },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  btn: { minHeight: 48, paddingHorizontal: 18, borderRadius: RADIUS.pill, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  chip: { paddingHorizontal: 14, minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 19, borderWidth: 1 },
  sectionHead: { flexDirection: 'row', alignItems: 'baseline', gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingVertical: 7 },
  rowIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  field: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 16, paddingHorizontal: 14, borderWidth: 1 },
});
