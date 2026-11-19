// Музыкальные компоненты: строка трека, шкала настройки, стеклянная панель с мини-плеером,
// меню трека и уведомления. Панель, меню и уведомления лежат поверх всего приложения,
// поэтому только они получают настоящее размытие (см. src/ui/glass.tsx).

import { useNetworkState } from 'expo-network';
import { router, usePathname } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Linking, Pressable, ScrollView, Share, StyleSheet, Text, useWindowDimensions, View, type GestureResponderEvent } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
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
import { playVideos, useVideo } from '@/player/video';
import { useMotion } from './ambient';
import { VideoMini } from './video';
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

export { playBadge } from './musicBadge';
import { canPlayViaYouTube, playBadge } from './musicBadge';
import { useYouTubeReady } from '@/services/fullVersion';

/** Три полоски «сейчас играет». Без постоянной анимации: она мешала прокрутке списков. */
export function Bars({ playing, color, size = 14 }: { playing: boolean; color: string; size?: number }) {
  const h = playing ? [0.55, 1, 0.75] : [0.35, 0.35, 0.35];
  return <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: size, width: size }}>{h.map((k, i) => <View key={i} style={{ width: 3, height: Math.max(2, k * size), borderRadius: 1.5, backgroundColor: color }} />)}</View>;
}

export function TrackRow({ t, onPress, note, index, right, testID, showSources }: { t: TrackView; onPress?: () => void; note?: string; index?: number; right?: React.ReactNode; testID?: string; showSources?: boolean }) {
  const c = useColors();
  const audioCurrent = usePlayer((p) => p.current?.id === t.id);
  const audioPlaying = usePlayer((p) => p.current?.id === t.id && p.playing);
  const videoCurrent = useVideo((v) => v.active && v.queue[v.index]?.id === t.id);
  const videoPlaying = useVideo((v) => v.active && v.queue[v.index]?.id === t.id && v.playing);
  const current = audioCurrent || videoCurrent;
  const playing = audioPlaying || videoPlaying;
  const yt = useYouTubeReady((y) => y.ready);
  const src = t.preferred;
  const badge = playBadge(src, yt);
  const state = src ? effectiveExplicit(src) : 'unknown';
  const tags = src ? parseTitle(src.title).versionTags : [];
  const dim = badge.tone === 'faint' && src?.availability !== 'region_blocked';
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
        {showSources ? <T v="small" c="faint" numberOfLines={1} style={{ marginTop: 1 }}>Найдено: {[...new Set(t.sources.map((x) => sourceName(x.source)))].join(', ')}</T> : null}
      </View>
      {right ?? <View style={{ marginRight: -10 }}><IconBtn name="more" label={`Действия: ${t.title}`} size={20} color={c.muted} onPress={() => openSheet(t)} /></View>}
    </Pressable>
  );
}

export function TrackList({ tracks, context, notes, numbered, showSources }: { tracks: TrackView[]; context: string; notes?: Map<string, string>; numbered?: boolean; showSources?: boolean }) {
  return <View>{tracks.map((t, i) => <TrackRow key={t.id} t={t} note={notes?.get(t.id)} index={numbered ? i + 1 : undefined} showSources={showSources} onPress={() => playOrOpen(tracks, i, context)} />)}</View>;
}

/** Запускает трек как умеет его источник: целиком, фрагментом, во встроенном плеере или через меню. */
export function playOrOpen(tracks: TrackView[], i: number, context: string) {
  const t = tracks[i];
  const mode = t.preferred ? playMode(t.preferred) : 'none';
  // YouTube подключён: песни из каталога играют целиком, видео для каждой ищется перед её началом.
  if (mode !== 'player' && useYouTubeReady.getState().ready && canPlayViaYouTube(t.sources.find((x) => x.source === 'youtube') ?? t.preferred)) {
    const list = tracks.filter((x) => (x.preferred ? playMode(x.preferred) : 'none') !== 'player' && canPlayViaYouTube(x.sources.find((y) => y.source === 'youtube') ?? x.preferred));
    playVideos(list, list.indexOf(t));
    return;
  }
  if (mode === 'player' || mode === 'preview') {
    const same = tracks.filter((x) => x.preferred && playMode(x.preferred) === mode);
    void playTracks(same, same.indexOf(t), mode === 'preview' ? 'preview' : context);
  } else if (mode === 'embed' && t.preferred?.source === 'youtube') {
    const videos = tracks.filter((x) => x.preferred?.source === 'youtube' && playMode(x.preferred) === 'embed');
    playVideos(videos, videos.indexOf(t));
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
  const cur = usePlayer((p) => p.current);
  const src = usePlayer((p) => p.source);
  const playing = usePlayer((p) => p.playing);
  const buffering = usePlayer((p) => p.buffering);
  const progress = usePlayer((p) => (p.durationSec ? p.positionSec / p.durationSec : 0));
  const start = useRef<number | null>(null);
  if (!cur) return null;
  const preview = src ? playMode(src) === 'preview' : false;
  return (
    <View>
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
    </View>
  );
}

function TabRow({ active }: { active: number }) {
  const c = useColors();
  const [w, setW] = useState(0);
  const x = useSharedValue(0);
  const motion = useMotion();
  const cell = w / TABS.length;
  useEffect(() => { x.value = motion ? withTiming(active * cell, { duration: 180 }) : active * cell; }, [active, cell, motion, x]);
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
  const video = useVideo((v) => v.active);
  const tab = TABS.findIndex((t) => t.href === path);
  const showMini = (hasTrack || video) && !HIDE_MINI.includes(path);
  if (tab < 0 && !showMini) return null;
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 10, right: 10, bottom: insets.bottom + 8 }}>
      <Glass floating radius={26} intensity={55} testID="dock">
        {showMini ? video ? <VideoMini /> : <MiniPlayer /> : null}
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
      <View style={[StyleSheet.absoluteFill, { backgroundColor: c.scrim }]}>
        <Pressable accessibilityLabel="Закрыть меню" style={{ flex: 1 }} onPress={close} />
      </View>
      <View style={{ position: 'absolute', left: 8, right: 8, bottom: insets.bottom + 8, maxHeight: height * 0.84 }}>
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
              <LicenseInfo s={src} />
              <VersionBlock t={t} onPick={async (s) => { await repo.setPreferredSource(t.id, s.id); if (usePlayer.getState().current?.id === t.id) await player.switchSource(s.id); bumpData(); player.invalidate(t.id); close(); toast(`Источник: ${sourceName(s.source)}`); }} />
              {playable ? <SheetAction icon="play" label="Слушать" onPress={() => go(() => void playTracks([t]))} /> : null}
              {playable ? <SheetAction icon="next" label="Играть следующим" onPress={() => go(() => void player.playNext(t.id))} /> : null}
              {playable ? <SheetAction icon="queue" label="Добавить в очередь" onPress={() => go(() => void player.addToQueue([t.id]))} /> : null}
              {!playable && embedSrc ? <SheetAction icon="play" label={embedSrc.source === 'youtube' ? 'Слушать на YouTube в приложении' : `Слушать в плеере ${sourceName(embedSrc.source)}`} onPress={() => go(() => (embedSrc.source === 'youtube' ? playVideos([t], 0) : openEmbed(t)))} /> : null}
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
              {t.sources.some((x) => x.source === 'local') ? <SheetAction icon="cover" label={t.sources.some((x) => x.extra?.needsInfo) ? 'Указать, что это за песня' : 'Изменить название и обложку'}
                sub={t.sources.some((x) => x.extra?.needsInfo) ? 'Файл пришёл без названия' : undefined} onPress={() => go(() => router.push({ pathname: '/identify/[id]', params: { id: t.id } }))} /> : null}
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
      </View>
    </View>
  );
}

/** Автор, лицензия, площадка и страница оригинала — для источников со свободными лицензиями. */
export function LicenseInfo({ s }: { s: SourceTrack | null | undefined }) {
  if (!s || (!s.licenseUrl && s.source !== 'openverse' && s.source !== 'jamendo')) return null;
  const x = (s.extra ?? {}) as Record<string, string | undefined>;
  const platform = x.providerName ?? sourceName(s.source);
  const license = x.licenseLabel ?? s.attribution?.split(',').find((p) => /CC|достояние|Sampling/i.test(p))?.trim();
  const link = (label: string, url?: string) => (url ? <T v="small" c="accent" accessibilityRole="link" onPress={() => void Linking.openURL(url)}>{label}</T> : <T v="small" c="muted">{label}</T>);
  return (
    <View testID="license-info" style={{ marginBottom: 10, gap: 2 }}>
      {link(`Автор: ${s.artist}`, x.creatorUrl)}
      {license ? link(`Лицензия: ${license}`, s.licenseUrl) : null}
      {link(`Страница оригинала на ${platform}`, s.externalUrl)}
      {s.source === 'openverse' ? <T v="small" c="faint">Найдено через Openverse. Openverse не проверяет лицензии: перед повторным использованием сверьте их на странице оригинала.</T> : null}
      {s.source === 'jamendo' || x.provider === 'jamendo' ? <T v="small" c="faint">Песни Jamendo играют только онлайн: условия Jamendo не разрешают приложениям хранить их на телефоне.</T> : null}
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
  const insets = useSafeAreaInsets();
  const text = useUi((u) => u.toast);
  if (!text) return null;
  return (
    <View key={text} pointerEvents="none" accessibilityLiveRegion="polite" style={{ position: 'absolute', top: insets.top + 8, left: 14, right: 14 }}>
      <Glass floating solid radius={RADIUS.card} intensity={60} style={{ paddingVertical: 12, paddingHorizontal: 16 }}><Text style={[TYPE.strong, { color: c.text }]}>{text}</Text></Glass>
    </View>
  );
}

// ---------- Кнопка воспроизведения ----------

/** Круглая кнопка воспроизведения. */
export function PlayOrb({ playing, size = 72, onPress, label, testID, busy }: { playing: boolean; size?: number; onPress: () => void; label: string; testID?: string; busy?: boolean }) {
  const c = useColors();
  return (
    <Press testID={testID} accessibilityRole="button" accessibilityLabel={label} onPress={onPress} disabled={busy} scaleTo={0.92}
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center', opacity: busy ? 0.7 : 1 }}>
      <Icon name={playing ? 'pause' : 'play'} size={size * 0.44} color={c.onAccent} />
    </Press>
  );
}
