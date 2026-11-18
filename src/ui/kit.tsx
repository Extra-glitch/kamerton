import { Image } from 'expo-image';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View, type StyleProp, type TextInputProps, type TextProps, type TextStyle, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { displayCover } from '@/sources/subsonic';
import { Icon, type IconName } from './icons';
import { BOTTOM_PAD, SPACE, TYPE, useColors, type TypeName } from './theme';

export function T({ v = 'body', c, style, ...rest }: TextProps & { v?: TypeName; c?: 'text' | 'muted' | 'faint' | 'accent' | 'warn' | 'danger' | 'onAccent' }) {
  const col = useColors();
  return <Text {...rest} style={[TYPE[v], { color: col[c ?? 'text'] }, style as StyleProp<TextStyle>]} />;
}

export function Screen({ children, title, back = true, right, scroll = true, onRefresh: _r }: { children: ReactNode; title?: string; back?: boolean; right?: ReactNode; scroll?: boolean; onRefresh?: () => void }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const head = title !== undefined || back ? (
    <View style={[s.head, { paddingTop: insets.top + 6 }]}>
      {back ? <IconBtn name="back" label="Назад" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} /> : null}
      <View style={{ flex: 1 }} />
      {right}
    </View>
  ) : <View style={{ height: insets.top + 14 }} />;
  const heading = title ? <T v="h1" style={{ marginBottom: 18 }} accessibilityRole="header">{title}</T> : null;
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      {head}
      {scroll ? (
        <ScrollView contentContainerStyle={{ paddingHorizontal: SPACE.page, paddingBottom: BOTTOM_PAD }} keyboardShouldPersistTaps="handled">{heading}{children}</ScrollView>
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

export function Btn({ label, onPress, kind = 'solid', icon, disabled, busy, style, testID }: { label: string; onPress?: () => void; kind?: 'solid' | 'line' | 'quiet'; icon?: IconName; disabled?: boolean; busy?: boolean; style?: StyleProp<ViewStyle>; testID?: string }) {
  const c = useColors();
  const fg = kind === 'solid' ? c.onAccent : c.text;
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} disabled={disabled || busy} onPress={onPress}
      style={({ pressed }) => [s.btn, kind === 'solid' && { backgroundColor: c.accent }, kind === 'line' && { borderWidth: 1.5, borderColor: c.line }, kind === 'quiet' && { paddingHorizontal: 0 }, { opacity: disabled ? 0.4 : pressed ? 0.75 : 1 }, style]}>
      {busy ? <ActivityIndicator size="small" color={fg} /> : icon ? <Icon name={icon} size={20} color={fg} /> : null}
      <Text style={[TYPE.strong, { color: fg, fontFamily: 'Body-700' }]}>{label}</Text>
    </Pressable>
  );
}

export function Chip({ label, on, onPress, testID }: { label: string; on?: boolean; onPress?: () => void; testID?: string }) {
  const c = useColors();
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityState={{ selected: !!on }} onPress={onPress} style={[s.chip, { borderColor: on ? c.accent : c.line, backgroundColor: on ? c.accent : 'transparent' }]}>
      <Text style={[TYPE.strong, { color: on ? c.onAccent : c.text }]}>{label}</Text>
    </Pressable>
  );
}

function hash(t: string) { let h = 0; for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0; return Math.abs(h); }

/** Обложка. Если её нет, рисуем типографскую, а не серую заглушку. */
export function Cover({ uri: stored, title, size, radius = 3, style }: { uri?: string; title: string; size: number | '100%'; radius?: number; style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  const uri = displayCover(stored);
  const [failed, setFailed] = useState(false);
  const box = { width: size, aspectRatio: 1, borderRadius: radius, overflow: 'hidden' as const };
  if (uri && !failed) return <Image source={uri} style={[box as never, { backgroundColor: c.raised }, style as never]} contentFit="cover" transition={120} recyclingKey={uri} onError={() => setFailed(true)} accessibilityIgnoresInvertColors />;
  const tone = c.coverTones[hash(title) % c.coverTones.length];
  const letter = title.trim().charAt(0).toUpperCase() || '♪';
  const n = typeof size === 'number' ? size : 320;
  return (
    <View style={[box, { backgroundColor: tone, justifyContent: 'flex-end' }, style]}>
      <Text allowFontScaling={false} style={{ fontFamily: 'Display-800', fontSize: n * 0.9, lineHeight: n * 0.92, color: c.text, opacity: 0.8, marginLeft: n * 0.08, marginBottom: -n * 0.1 }}>{letter}</Text>
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
      {note ? <T v="small" c="muted" style={{ marginTop: 2 }}>{note}</T> : null}
      <View style={{ marginTop: 12 }}>{children}</View>
    </View>
  );
}

export function Shelf({ children }: { children: ReactNode }) {
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -SPACE.page }} contentContainerStyle={{ paddingHorizontal: SPACE.page, gap: 14 }}>{children}</ScrollView>;
}

export function Empty({ title, text, action, onAction }: { title: string; text: string; action?: string; onAction?: () => void }) {
  return (
    <View style={{ paddingVertical: 26 }}>
      <T v="h3">{title}</T>
      <T c="muted" style={{ marginTop: 6, maxWidth: 420 }}>{text}</T>
      {action ? <Btn label={action} onPress={onAction} style={{ marginTop: 16, alignSelf: 'flex-start' }} /> : null}
    </View>
  );
}

export function Notice({ text, tone = 'muted' }: { text: string; tone?: 'muted' | 'warn' | 'danger' }) {
  const c = useColors();
  return <View style={{ borderLeftWidth: 3, borderLeftColor: c[tone === 'muted' ? 'line' : tone], paddingLeft: 12, paddingVertical: 3, marginVertical: 8 }}><T v="small" c={tone}>{text}</T></View>;
}

export function Loading({ label }: { label?: string }) {
  const c = useColors();
  return <View style={{ paddingVertical: 34, alignItems: 'flex-start', gap: 10 }}><ActivityIndicator color={c.accent} />{label ? <T v="small" c="muted">{label}</T> : null}</View>;
}

export function Row({ title, sub, onPress, right, icon, danger, testID }: { title: string; sub?: string; onPress?: () => void; right?: ReactNode; icon?: IconName; danger?: boolean; testID?: string }) {
  const c = useColors();
  return (
    <Pressable testID={testID} disabled={!onPress} onPress={onPress} accessibilityRole={onPress ? 'button' : undefined} style={({ pressed }) => [s.row, { opacity: pressed ? 0.6 : 1 }]}>
      {icon ? <Icon name={icon} size={22} color={danger ? c.danger : c.muted} /> : null}
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

export function Field({ label, hint, style, ...rest }: TextInputProps & { label?: string; hint?: string }) {
  const c = useColors();
  return (
    <View style={{ marginBottom: 14 }}>
      {label ? <T v="strong" style={{ marginBottom: 5 }}>{label}</T> : null}
      <TextInput accessibilityLabel={label ?? rest.placeholder} placeholderTextColor={c.faint} {...rest} style={[TYPE.body, { color: c.text, backgroundColor: c.sunken, borderRadius: 4, paddingHorizontal: 12, paddingVertical: 11, borderWidth: 1, borderColor: c.line }, style]} />
      {hint ? <T v="small" c="muted" style={{ marginTop: 4 }}>{hint}</T> : null}
    </View>
  );
}

export const s = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingBottom: 4 },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  btn: { minHeight: 46, paddingHorizontal: 18, borderRadius: 3, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  chip: { paddingHorizontal: 13, minHeight: 38, justifyContent: 'center', borderRadius: 19, borderWidth: 1.5 },
  sectionHead: { flexDirection: 'row', alignItems: 'baseline', gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 54, paddingVertical: 7 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
