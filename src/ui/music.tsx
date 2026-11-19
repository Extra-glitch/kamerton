// Музыкальные компоненты: строка трека, шкала настройки, стеклянная панель с мини-плеером,
// меню трека и уведомления. Панель, меню и уведомления лежат поверх всего приложения,
// поэтому только они получают настоящее размытие (см. src/ui/glass.tsx).

import { useNetworkState } from 'expo-network';
import { router, usePathname } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Linking, Pressable, ScrollView, Share, StyleSheet, Text, useWindowDimensions, View, type GestureResponderEvent } from 'react-native';
import Animated, { cancelAnimation, Easing, FadeIn, FadeInDown, FadeOut, FadeOutDown, SlideInDown, SlideOutDown, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Line } from 'react-native-svg';
import { AVAILABILITY_LABEL, effectiveExplicit } from '@/core/choose';
import { formatDuration } from '@/core/text';
import type { AudioQuality, SourceTrack, TrackView } from '@/core/types';
import { explicitLabel, parseTitle, versionLabel } from '@/core/versions';
import * as repo from '@/db/repo';
import { adapter, LISTEN_ELSEWHERE, playMode, sourceName } from '@/sources/registry';
import { applyFeedback } from '@/services/reco';
import { resolveStream } from '@/services/media';
import { bumpData, closeSheet, openSheet, player, playTracks, toast, useUi, usePlayer } from '@/state/app';
import { downloadToApp } from '@/platform/localMusic';
import { useMotion } from './ambient';
import { Glass } from './glass';
import { Icon, type IconName } from './icons';
import { Badge, Cover, IconBtn, Press, T } from './kit';
import { MINI_HEIGHT, RADIUS, TAB_HEIGHT, TYPE, useColors } from './theme';

export function qualityText(q?: AudioQuality): string | null {
  if (!q) return null;
  const parts: string[] = [];
  if (q.codec) parts.push(q.codec);
  if (q.lossless) parts.push('без потерь');
  if (q.bitDepth && q.sampleRateHz) parts.push(`${q.bitDepth} бит, ${(q.sampleRateHz / 1000).toFixed(q.sampleRateHz % 1000 ? 1 : 0)} кГц`);
  else if (q.bitrateKbps) parts.push(`${q.bitrateKbps} кбит/с`);
  return parts.length ? parts.join(', ') : null;
}

/** Короткая подпись версии. Неизвестность не скрываем. */
export function versionMark(s: SourceTrack): { text: string; tone: 'muted' | 'warn' | 'accent' | 'faint' } {
  const state = effectiveExplicit(s);
  const tags = parseTitle(s.title).versionTags;
  if (state === 'clean') return { text: 'с цензурой', tone: 'warn' };
  if (tags.includes('radio_edit')) return { text: 'радиоверсия', tone: 'warn' };
  if (state === 'explicit') return { text: 'E', tone: 'accent' };
  if (state === 'not_explicit') return { text: 'оригинал', tone: 'muted' };
  return { text: 'версия?', tone: 'faint' };
}

/** Как трек играет в Камертоне: короткая подпись для строки списка. */
export function playBadge(s: SourceTrack | null): { label: string; tone: 'ok' | 'warn' | 'muted' | 'faint' } {
  if (!s) return { label: 'нет источника', tone: 'faint' };
  const m = playMode(s);
  if (m === 'player') return s.localPath ? { label: 'на телефоне', tone: 'ok' } : { label: 'целиком', tone: 'ok' };
  if (m === 'preview') return { label: 'фрагмент', tone: 'warn' };
  if (m === 'embed') return { label: sourceName(s.source), tone: 'muted' };
  return { label: s.availability === 'region_blocked' ? 'недоступно' : 'ссылка', tone: 'faint' };
}

/** Три полоски «сейчас играет». */
export function Bars({ playing, color, size = 14 }: { playing: boolean; color: string; size?: number }) {
  const motion = useMotion();
  const v = [useSharedValue(0.4), useSharedValue(0.8), useSharedValue(0.55)];
  useEffect(() => {
    v.forEach((x, i) => {
      if (playing && motion) x.value = withRepeat(withSequence(withTiming(1, { duration: 280 + i * 90, easing: Easing.inOut(Easing.quad) }), withTiming(0.25, { duration: 320 + i * 70, easing: Easing.inOut(Easing.quad) })), -1, true);
      else { cancelAnimation(x); x.value = withTiming(0.35, { duration: 200 }); }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, motion]);
  const st = v.map((x) => useAnimatedStyle(() => ({ height: Math.max(2, x.value * size) })));
  return <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: size, width: size }}>{st.map((a, i) => <Animated.View key={i} style={[{ width: 3, borderRadius: 1.5, backgroundColor: color }, a]} />)}</View>;
}

export function TrackRow({ t, onPress, note, index, right, testID }: { t: TrackView; onPress?: () => void; note?: string; index?: number; right?: React.ReactNode; testID?: string }) {
  const c = useColors();
  const current = usePlayer((p) => p.current?.id === t.id);
  const playing = usePlayer((p) => p.current?.id === t.id && p.playing);
  const src = t.preferred;
  const badge = playBadge(src);
  const state = src ? effectiveExplicit(src) : 'unknown';
  const tags = src ? parseTitle(src.title).versionTags : [];
  const dim = badge.tone === 'faint';
  return (
    <Pressable testID={testID} onPress={onPress} onLongPress={() => openSheet(t)} accessibilityRole="button" accessibilityLabel={`${t.title}, ${t.artist}, ${badge.label}`}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 7, opacity: pressed ? 0.6 : dim ? 0.7 : 1 })}>
      {index !== undefined ? <T v="h3" c="faint" style={{ width: 24, textAlign: 'right' }}>{index}</T> : null}
      <View>
        <Cover uri={t.coverUrl ?? src?.coverUrl} title={t.artist} size={52} radius={10} />
        {current ? <View style={[StyleSheet.absoluteFill, { borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' }]}><Bars playing={playing} color="#ffffff" size={16} /></View> : null}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <T v="title" numberOfLines={1} c={current ? 'accent' : 'text'} style={{ flexShrink: 1 }}>{t.title}</T>
          {state === 'explicit' ? <Badge label="E" tone="muted" /> : null}
          {state === 'clean' ? <Badge label="цензура" tone="warn" /> : tags.includes('radio_edit') ? <Badge label="радио" tone="warn" /> : null}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
          <Badge label={badge.label} tone={badge.tone} />
          <T v="small" c="muted" numberOfLines={1} style={{ flexShrink: 1 }}>{t.artist}</T>
          {t.durationSec ? <T v="small" c="faint" style={{ marginLeft: 'auto' }}>{formatDuration(t.durationSec)}</T> : null}
        </View>
        {note ? <T v="small" c="faint" numberOfLines={2} style={{ marginTop: 2 }}>{note}</T> : null}
      </View>
      {right ?? <View style={{ marginRight: -10 }}><IconBtn name="more" label={`Действия: ${t.title}`} size={20} color={c.muted} onPress={() => openSheet(t)} /></View>}
    </Pressable>
  );
}

export function TrackList({ tracks, context, notes, numbered }: { tracks: TrackView[]; context: string; notes?: Map<string, string>; numbered?: boolean }) {
  return <View>{tracks.map((t, i) => <TrackRow key={t.id} t={t} note={notes?.get(t.id)} index={numbered ? i + 1 : undefined} onPress={() => playOrOpen(tracks, i, context)} />)}</View>;
}

let previewHinted = false;

/** Запускает трек как умеет его источник: целиком, фрагментом, во встроенном плеере или через меню. */
export function playOrOpen(tracks: TrackView[], i: number, context: string) {
  const t = tracks[i];
  const mode = t.preferred ? playMode(t.preferred) : 'none';
  if (mode === 'player' || mode === 'preview') {
    const same = tracks.filter((x) => x.preferred && playMode(x.preferred) === mode);
    void playTracks(same, same.indexOf(t), mode === 'preview' ? 'preview' : context);
    if (mode === 'preview' && !previewHinted) { previewHinted = true; toast('Играет фрагмент 30 секунд. Полностью: «⋯» → Яндекс Музыка, VK или Звук'); }
  } else if (mode === 'embed') openEmbed(t);
  else openSheet(t);
}

export const openEmbed = (t: TrackView) => router.push({ pathname: '/embed', params: { id: t.id } });

const TICK = 7;

/** Шкала настройки: фирменный элемент для перемотки и степени открытий. */
export function Dial({ value, onChange, onCommit, height = 42, label, disabled, testID }: { value: number; onChange?: (v: number) => void; onCommit?: (v: number) => void; height?: number; label: string; disabled?: boolean; testID?: string }) {
  const c = useColors();
  const [w, setW] = useState(0);
  const [drag, setDrag] = useState<number | null>(null);
  const shown = Math.max(0, Math.min(1, drag ?? value));
  const count = Math.floor(w / TICK);
  const ticks = useMemo(() => Array.from({ length: count + 1 }, (_, i) => i), [count]);
  const at = (e: GestureResponderEvent) => Math.max(0, Math.min(1, e.nativeEvent.locationX / (w || 1)));
  const active = Math.round(shown * count);
  return (
    <View testID={testID} accessible accessibilityRole="adjustable" accessibilityLabel={label} accessibilityValue={{ min: 0, max: 100, now: Math.round(shown * 100) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]} onAccessibilityAction={(e) => { const v = Math.max(0, Math.min(1, shown + (e.nativeEvent.actionName === 'increment' ? 0.05 : -0.05))); onCommit?.(v); }}
      onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ height, opacity: disabled ? 0.4 : 1 }}
      onStartShouldSetResponder={() => !disabled} onMoveShouldSetResponder={() => !disabled} onResponderTerminationRequest={() => false}
      onResponderGrant={(e) => { const v = at(e); setDrag(v); onChange?.(v); }} onResponderMove={(e) => { const v = at(e); setDrag(v); onChange?.(v); }}
      onResponderRelease={(e) => { const v = at(e); setDrag(null); onCommit?.(v); }} onResponderTerminate={() => setDrag(null)}>
      <View pointerEvents="none">
        <Svg width={w} height={height}>
          {ticks.map((i) => {
            const major = i % 5 === 0;
            const near = Math.abs(i - active);
            const h = (major ? height * 0.5 : height * 0.28) + (drag !== null && near < 4 ? (4 - near) * 2.5 : 0);
            return <Line key={i} x1={i * TICK + 1.5} x2={i * TICK + 1.5} y1={(height - h) / 2} y2={(height + h) / 2} stroke={i <= active ? c.accent : c.line} strokeWidth={major ? 2.2 : 1.6} strokeLinecap="round" />;
          })}
          <Line x1={active * TICK + 1.5} x2={active * TICK + 1.5} y1={2} y2={height - 2} stroke={c.text} strokeWidth={3} strokeLinecap="round" />
        </Svg>
      </View>
    </View>
  );
}

// ---------- Нижняя стеклянная панель ----------

const TABS: { name: string; href: '/' | '/search' | '/library' | '/profile'; label: string; icon: IconName }[] = [
  { name: 'index', href: '/', label: 'Волна', icon: 'wave' },
  { name: 'search', href: '/search', label: 'Поиск', icon: 'search' },
  { name: 'library', href: '/library', label: 'Коллекция', icon: 'library' },
  { name: 'profile', href: '/profile', label: 'Профиль', icon: 'user' },
];
const HIDE_MINI = ['/player', '/queue', '/lyrics', '/onboarding', '/embed'];

function MiniPlayer() {
  const c = useColors();
  const motion = useMotion();
  const cur = usePlayer((p) => p.current);
  const src = usePlayer((p) => p.source);
  const playing = usePlayer((p) => p.playing);
  const buffering = usePlayer((p) => p.buffering);
  const progress = usePlayer((p) => (p.durationSec ? p.positionSec / p.durationSec : 0));
  const start = useRef<number | null>(null);
  if (!cur) return null;
  const preview = src ? playMode(src) === 'preview' : false;
  return (
    <Animated.View entering={motion ? FadeInDown.duration(260) : undefined} exiting={motion ? FadeOutDown.duration(200) : undefined}>
      <Pressable testID="mini-player" accessibilityRole="button" accessibilityLabel={`Открыть плеер: ${cur.title}`} onPress={() => router.push('/player')}
        onTouchStart={(e) => { start.current = e.nativeEvent.pageX; }}
        onTouchEnd={(e) => { const d = start.current === null ? 0 : e.nativeEvent.pageX - start.current; start.current = null; if (d < -70) void player.next(); else if (d > 70) void player.previous(); }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 11, height: MINI_HEIGHT, paddingLeft: 9, paddingRight: 4 }}>
        <Cover uri={cur.coverUrl ?? src?.coverUrl} title={cur.artist} size={46} radius={12} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <T v="title" numberOfLines={1}>{cur.title}</T>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {preview ? <Badge label="фрагмент" tone="warn" /> : null}
            <T v="small" c="muted" numberOfLines={1} style={{ flexShrink: 1 }}>{buffering ? 'Загружается…' : cur.artist}</T>
          </View>
        </View>
        <IconBtn testID="mini-toggle" name={playing ? 'pause' : 'play'} label={playing ? 'Пауза' : 'Играть'} onPress={() => player.toggle()} />
        <IconBtn name="next" label="Следующий трек" onPress={() => void player.next()} />
      </Pressable>
      <View style={{ height: 2, marginHorizontal: 14, borderRadius: 1, backgroundColor: c.line, overflow: 'hidden' }}><View style={{ height: 2, width: `${progress * 100}%`, backgroundColor: c.accent }} /></View>
    </Animated.View>
  );
}

function TabRow({ active }: { active: number }) {
  const c = useColors();
  const [w, setW] = useState(0);
  const x = useSharedValue(0);
  const motion = useMotion();
  const cell = w / TABS.length;
  useEffect(() => { x.value = motion ? withSpring(active * cell, { damping: 18, stiffness: 190 }) : active * cell; }, [active, cell, motion, x]);
  const pill = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  return (
    <View accessibilityRole="tablist" onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ flexDirection: 'row', height: TAB_HEIGHT, paddingHorizontal: 0 }}>
      {w > 0 ? <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: 7, bottom: 7, left: 6, width: cell - 12, borderRadius: 18, backgroundColor: c.accentSoft }, pill]} /> : null}
      {TABS.map((tab, i) => {
        const on = i === active;
        return (
          <Pressable key={tab.name} testID={`tab-${tab.name}`} accessibilityRole="tab" accessibilityLabel={tab.label} accessibilityState={{ selected: on }} onPress={() => { if (!on) router.navigate(tab.href); }}
            style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2 }}>
            <Icon name={tab.icon} size={22} color={on ? c.accent : c.muted} />
            <Text allowFontScaling={false} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={{ fontFamily: on ? 'Body-700' : 'Body-500', fontSize: 11.5, color: on ? c.text : c.muted }}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Плавающая стеклянная панель: мини-плеер и разделы. Лежит вне BlurTargetView, поэтому размывает всё под собой. */
export function Dock() {
  const insets = useSafeAreaInsets();
  const path = usePathname();
  const hasTrack = usePlayer((p) => !!p.current);
  const tab = TABS.findIndex((t) => t.href === path);
  const showMini = hasTrack && !HIDE_MINI.includes(path);
  if (tab < 0 && !showMini) return null;
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 10, right: 10, bottom: insets.bottom + 8 }}>
      <Glass floating radius={26} intensity={55} testID="dock">
        {showMini ? <MiniPlayer /> : null}
        {tab >= 0 ? <TabRow active={tab} /> : null}
      </Glass>
    </View>
  );
}

// ---------- Меню трека ----------

function SheetAction({ icon, label, onPress, tone, sub }: { icon: IconName; label: string; onPress: () => void; tone?: 'accent' | 'danger'; sub?: string }) {
  const c = useColors();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => ({ flexDirection: 'row', gap: 14, alignItems: 'center', minHeight: 48, opacity: pressed ? 0.55 : 1 })}>
      <View style={{ width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: tone ? c.accentSoft : c.glass }}><Icon name={icon} size={19} color={tone ? c[tone] : c.text} /></View>
      <View style={{ flex: 1 }}><T v="strong" c={tone ?? 'text'}>{label}</T>{sub ? <T v="small" c="muted">{sub}</T> : null}</View>
    </Pressable>
  );
}

const go = (fn: () => void) => { closeSheet(); setTimeout(fn, 30); };

export function TrackSheet() {
  const c = useColors();
  const motion = useMotion();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const t = useUi((u) => u.sheetTrack);
  const [mode, setMode] = useState<'main' | 'playlist'>('main');
  const [lists, setLists] = useState<Awaited<ReturnType<typeof repo.listPlaylists>>>([]);
  const close = () => { setMode('main'); closeSheet(); };
  useEffect(() => {
    if (!t) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { close(); return true; });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);
  if (!t) return null;
  const src = t.preferred;
  const pm = src ? playMode(src) : 'none';
  const playable = pm === 'player';
  const react = async (kind: 'like' | 'dislike' | 'more' | 'less' | 'hide', msg: string) => {
    const on = kind === 'like' ? !t.liked : true;
    await applyFeedback(t.id, kind, on); bumpData(); player.invalidate(t.id); close(); toast(kind === 'like' && !on ? 'Убрано из любимого' : msg);
  };
  const originals = t.sources.filter((s) => s.externalUrl && !s.localPath && !LISTEN_ELSEWHERE.includes(s.source)).slice(0, 2);
  const embedSrc = t.sources.find((s) => playMode(s) === 'embed');
  const previewSrc = t.sources.find((s) => playMode(s) === 'preview');
  const offlineSrc = t.sources.find((s) => s.canOffline && !s.localPath && adapter(s.source)?.capabilities.canOffline);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View entering={motion ? FadeIn.duration(180) : undefined} exiting={motion ? FadeOut.duration(160) : undefined} style={[StyleSheet.absoluteFill, { backgroundColor: c.scrim }]}>
        <Pressable accessibilityLabel="Закрыть меню" style={{ flex: 1 }} onPress={close} />
      </Animated.View>
      <Animated.View entering={motion ? SlideInDown.springify().damping(20).stiffness(170) : undefined} exiting={motion ? SlideOutDown.duration(200) : undefined} style={{ position: 'absolute', left: 8, right: 8, bottom: insets.bottom + 8, maxHeight: height * 0.84 }}>
        <Glass floating radius={28} intensity={70}>
          <View style={{ alignSelf: 'center', width: 38, height: 4, borderRadius: 2, backgroundColor: c.line, marginTop: 8 }} />
          <ScrollView contentContainerStyle={{ padding: 18, paddingTop: 12 }}>
            <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center', marginBottom: 12 }}>
              <Cover uri={t.coverUrl} title={t.artist} size={58} radius={14} />
              <View style={{ flex: 1 }}><T v="h3" numberOfLines={2}>{t.title}</T><T v="small" c="muted" numberOfLines={1}>{t.artist}{t.album ? `, ${t.album}` : ''}</T></View>
            </View>
            {mode === 'playlist' ? <>
              <SheetAction icon="plus" label="Новый плейлист" onPress={async () => { const id = await repo.createPlaylist({ name: t.title }); await repo.addTrackToPlaylist(id, t.id); bumpData(); close(); toast('Плейлист создан'); }} />
              {lists.map((p) => <SheetAction key={p.id} icon="queue" label={p.name} onPress={async () => { await repo.addTrackToPlaylist(p.id, t.id); bumpData(); close(); toast(`Добавлено в «${p.name}»`); }} />)}
            </> : <>
              <VersionBlock t={t} onPick={async (s) => { await repo.setPreferredSource(t.id, s.id); if (usePlayer.getState().current?.id === t.id) await player.switchSource(s.id); bumpData(); player.invalidate(t.id); close(); toast(`Источник: ${sourceName(s.source)}`); }} />
              {playable ? <SheetAction icon="play" label="Слушать" onPress={() => go(() => void playTracks([t]))} /> : null}
              {playable ? <SheetAction icon="next" label="Играть следующим" onPress={() => go(() => void player.playNext(t.id))} /> : null}
              {playable ? <SheetAction icon="queue" label="Добавить в очередь" onPress={() => go(() => void player.addToQueue([t.id]))} /> : null}
              {!playable && embedSrc ? <SheetAction icon="play" label={`Слушать в плеере ${sourceName(embedSrc.source)}`} sub="В России нужен VPN" onPress={() => go(() => openEmbed(t))} /> : null}
              {!playable && previewSrc ? <SheetAction icon="play" label="Послушать фрагмент 30 секунд" sub={sourceName(previewSrc.source)} onPress={() => go(() => void player.playList([{ trackId: t.id, sourceTrackId: previewSrc.id }], 0, 'preview'))} /> : null}
              {!playable ? <View style={{ marginVertical: 6 }}>
                <T v="small" c="muted" style={{ marginBottom: 6 }}>Полностью эту песню можно послушать по подписке:</T>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {LISTEN_ELSEWHERE.map((id) => adapter(id)).filter((a) => a?.externalUrl).map((a) => (
                    <Press key={a!.id} accessibilityRole="link" onPress={() => { void Linking.openURL(a!.externalUrl!({ title: t.title, artist: t.artist })!); close(); }}
                      style={{ paddingHorizontal: 14, height: 40, borderRadius: 20, backgroundColor: c.accent, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Icon name="link" size={16} color={c.onAccent} /><Text style={[TYPE.strong, { color: c.onAccent }]}>{a!.name}</Text>
                    </Press>
                  ))}
                </View>
              </View> : null}
              <SheetAction icon={t.liked ? 'heartOn' : 'heart'} tone={t.liked ? 'accent' : undefined} label={t.liked ? 'Убрать из любимого' : 'В любимое'} onPress={() => void react('like', 'Добавлено в любимое')} />
              <SheetAction icon="plus" label="Добавить в плейлист" onPress={async () => { setLists((await repo.listPlaylists()).filter((p) => !p.smartRule)); setMode('playlist'); }} />
              <SheetAction icon="similar" label="Похожие композиции" onPress={() => go(() => router.push({ pathname: '/similar/[id]', params: { id: t.id } }))} />
              {playable ? <SheetAction icon="radio" label="Создать радио по этой песне" onPress={() => go(() => void player.playList([{ trackId: t.id }], 0, `radio:${t.id}`))} /> : null}
              <SheetAction icon="user" label="Перейти к исполнителю" onPress={() => go(() => router.push({ pathname: '/artist/[name]', params: { name: t.artist, ...(src?.source === 'deezer' && src.artistId ? { deezer: src.artistId } : {}) } }))} />
              {src?.albumId && adapter(src.source)?.albumTracks ? <SheetAction icon="cover" label="Перейти к альбому" onPress={() => go(() => router.push({ pathname: '/album/[source]/[id]', params: { source: src.source, id: src.albumId!, title: t.album ?? '' } }))} /> : null}
              <SheetAction icon="up" label="Больше такого" onPress={() => void react('more', 'Будет больше похожего')} />
              <SheetAction icon="down" label="Меньше такого" onPress={() => void react('less', 'Будет меньше похожего')} />
              <SheetAction icon="thumbDown" label="Не нравится" onPress={() => void react('dislike', 'Учтём это в рекомендациях')} />
              <SheetAction icon="close" label="Скрыть из рекомендаций" onPress={() => void react('hide', 'Трек больше не появится')} />
              {offlineSrc ? <SheetAction icon="download" label="Сохранить на телефон" sub="Разрешено лицензией источника" onPress={async () => {
                close(); toast('Сохраняем…');
                try { const r = await resolveStream(offlineSrc); const f = await downloadToApp(r.uri, `${offlineSrc.id.replace(/[^\w.-]+/g, '_')}.audio`); await repo.addDownload(offlineSrc.id, f.uri, f.size); bumpData(); toast('Сохранено на телефон'); }
                catch (e) { toast((e as Error).message); }
              }} /> : null}
              {originals.map((s) => <SheetAction key={s.id} icon="link" label={`Открыть в ${sourceName(s.source)}`} onPress={() => { void Linking.openURL(s.externalUrl!); close(); }} />)}
              <SheetAction icon="share" label="Поделиться" onPress={() => { close(); void Share.share({ message: `${t.artist} — ${t.title}${src?.externalUrl ? `\n${src.externalUrl}` : ''}` }); }} />
            </>}
          </ScrollView>
        </Glass>
      </Animated.View>
    </View>
  );
}

/** Версия, статус и все источники композиции. Здесь пользователь выбирает, откуда слушать. */
function VersionBlock({ t, onPick }: { t: TrackView; onPick: (s: SourceTrack) => void }) {
  const c = useColors();
  const tags = t.versionTags.map(versionLabel);
  return (
    <View style={{ marginBottom: 10, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: c.line }}>
      {tags.length ? <T v="small" c="warn">Версия: {tags.join(', ').toLowerCase()}</T> : null}
      {t.sources.map((s) => {
        const on = s.id === t.preferred?.id;
        const q = qualityText(s.quality);
        const b = playBadge(s);
        return (
          <Pressable key={s.id} accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={() => onPick(s)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7 }}>
            <View style={{ width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: on ? c.accent : c.stroke, alignItems: 'center', justifyContent: 'center' }}>{on ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.accent }} /> : null}</View>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}><T v="strong">{sourceName(s.source)}</T><Badge label={b.label} tone={b.tone} /></View>
              <T v="small" c="muted">{explicitLabel(effectiveExplicit(s), parseTitle(s.title).versionTags)}</T>
              <T v="small" c={s.availability === 'full' ? 'faint' : 'warn'}>{AVAILABILITY_LABEL[s.availability]}{q ? `, ${q}` : ''}</T>
              {s.attribution ? <T v="small" c="faint">{s.attribution}</T> : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

export function OfflineBanner() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const net = useNetworkState();
  if (net.isConnected !== false && net.isInternetReachable !== false) return null;
  return (
    <View accessibilityLiveRegion="polite" pointerEvents="none" style={{ position: 'absolute', top: insets.top + 4, alignSelf: 'center' }}>
      <View style={{ backgroundColor: c.warn, paddingVertical: 5, paddingHorizontal: 14, borderRadius: 14 }}><Text style={[TYPE.small, { color: '#2A1A00' }]}>Нет интернета. Работают файлы на телефоне и сохранённое.</Text></View>
    </View>
  );
}

export function Toast() {
  const c = useColors();
  const motion = useMotion();
  const insets = useSafeAreaInsets();
  const text = useUi((u) => u.toast);
  if (!text) return null;
  return (
    <Animated.View key={text} entering={motion ? FadeInDown.duration(220) : undefined} exiting={motion ? FadeOut.duration(200) : undefined} pointerEvents="none" accessibilityLiveRegion="polite" style={{ position: 'absolute', top: insets.top + 8, left: 14, right: 14 }}>
      <Glass floating solid radius={RADIUS.card} intensity={60} style={{ paddingVertical: 12, paddingHorizontal: 16 }}><Text style={[TYPE.strong, { color: c.text }]}>{text}</Text></Glass>
    </Animated.View>
  );
}

// ---------- Кнопка-камертон ----------

function Ring({ delay, size, color }: { delay: number; size: number; color: string }) {
  const k = useSharedValue(0);
  useEffect(() => {
    const id = setTimeout(() => { k.value = withRepeat(withTiming(1, { duration: 2200, easing: Easing.out(Easing.quad) }), -1, false); }, delay);
    return () => { clearTimeout(id); cancelAnimation(k); };
  }, [delay, k]);
  const st = useAnimatedStyle(() => ({ opacity: 0.55 * (1 - k.value), transform: [{ scale: 1 + k.value * 0.7 }] }));
  return <Animated.View pointerEvents="none" style={[{ position: 'absolute', width: size, height: size, borderRadius: size / 2, borderWidth: 2, borderColor: color }, st]} />;
}

/** Круглая кнопка воспроизведения. Пока звучит музыка, от неё расходятся волны, как от камертона. */
export function PlayOrb({ playing, size = 72, onPress, label, testID, busy }: { playing: boolean; size?: number; onPress: () => void; label: string; testID?: string; busy?: boolean }) {
  const c = useColors();
  const motion = useMotion();
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {playing && motion ? <><Ring delay={0} size={size} color={c.accent} /><Ring delay={1100} size={size} color={c.accent} /></> : null}
      <Press testID={testID} accessibilityRole="button" accessibilityLabel={label} onPress={onPress} disabled={busy} scaleTo={0.92}
        style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center', opacity: busy ? 0.7 : 1 }}>
        <Icon name={playing ? 'pause' : 'play'} size={size * 0.44} color={c.onAccent} />
      </Press>
    </View>
  );
}
