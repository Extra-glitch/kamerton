// Музыкальные компоненты: строка трека, шкала настройки, мини-плеер, меню трека.

import { useNetworkState } from 'expo-network';
import { router, usePathname } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Linking, Modal, Pressable, ScrollView, Share, Text, View, type GestureResponderEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Line } from 'react-native-svg';
import { AVAILABILITY_LABEL, effectiveExplicit } from '@/core/choose';
import { formatDuration } from '@/core/text';
import type { AudioQuality, SourceTrack, TrackView } from '@/core/types';
import { explicitLabel, parseTitle, versionLabel } from '@/core/versions';
import * as repo from '@/db/repo';
import { adapter, sourceName } from '@/sources/registry';
import { applyFeedback, linkAdapters } from '@/services/reco';
import { resolveStream } from '@/services/media';
import { bumpData, closeSheet, openSheet, player, playTracks, toast, useUi, usePlayer } from '@/state/app';
import { downloadToApp } from '@/platform/localMusic';
import { Icon, type IconName } from './icons';
import { Cover, IconBtn, T } from './kit';
import { FONT, TAB_HEIGHT, TYPE, useColors } from './theme';

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

export function TrackRow({ t, onPress, note, index, right, testID }: { t: TrackView; onPress?: () => void; note?: string; index?: number; right?: React.ReactNode; testID?: string }) {
  const c = useColors();
  const current = usePlayer((p) => p.current?.id === t.id);
  const src = t.preferred;
  const extra = new Set(t.sources.map((x) => x.source)).size - 1;
  const mark = src ? versionMark(src) : null;
  const blocked = src && src.availability !== 'full';
  return (
    <Pressable testID={testID} onPress={onPress} onLongPress={() => openSheet(t)} accessibilityRole="button" accessibilityLabel={`${t.title}, ${t.artist}`} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7, opacity: pressed ? 0.6 : blocked ? 0.62 : 1 })}>
      {index !== undefined ? <T v="h3" c="faint" style={{ width: 26, textAlign: 'right' }}>{index}</T> : null}
      <Cover uri={t.coverUrl ?? src?.coverUrl} title={t.artist} size={54} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <T v="title" numberOfLines={1} c={current ? 'accent' : 'text'}>{t.title}</T>
        <T v="small" c="muted" numberOfLines={1}>{t.artist}</T>
        <View style={{ flexDirection: 'row', gap: 6, marginTop: 1, alignItems: 'center' }}>
          <T v="small" c="faint" numberOfLines={1} style={{ flexShrink: 1 }}>{src ? sourceName(src.source) : 'Нет источника'}{extra > 0 ? ` и ещё ${extra}` : ''}</T>
          {mark ? <T v="small" c={mark.tone} style={mark.text === 'E' ? { fontFamily: FONT.b7 } : undefined}>{mark.text}</T> : null}
          {blocked ? <T v="small" c="warn" numberOfLines={1} style={{ flexShrink: 1 }}>{AVAILABILITY_LABEL[src.availability]}</T> : null}
          {t.durationSec ? <T v="small" c="faint" style={{ marginLeft: 'auto' }}>{formatDuration(t.durationSec)}</T> : null}
        </View>
        {note ? <T v="small" c="muted" numberOfLines={2} style={{ marginTop: 1 }}>{note}</T> : null}
      </View>
      {right ?? <View style={{ marginRight: -10 }}><IconBtn name="more" label={`Действия: ${t.title}`} size={20} color={c.muted} onPress={() => openSheet(t)} /></View>}
    </Pressable>
  );
}

export function TrackList({ tracks, context, notes, numbered }: { tracks: TrackView[]; context: string; notes?: Map<string, string>; numbered?: boolean }) {
  return <View>{tracks.map((t, i) => <TrackRow key={t.id} t={t} note={notes?.get(t.id)} index={numbered ? i + 1 : undefined} onPress={() => playOrOpen(tracks, i, context)} />)}</View>;
}

/** Запускает трек, а если он не играет в приложении, предлагает честный выбор в меню. */
export function playOrOpen(tracks: TrackView[], i: number, context: string) {
  const t = tracks[i];
  const s = t.preferred;
  if (s && s.availability === 'full' && adapter(s.source)?.resolveStream) {
    const playable = tracks.filter((x) => x.preferred?.availability === 'full' && adapter(x.preferred.source)?.resolveStream);
    void playTracks(playable, playable.indexOf(t), context);
  } else openSheet(t);
}

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
            const h = major ? height * 0.52 : height * 0.3;
            return <Line key={i} x1={i * TICK + 1} x2={i * TICK + 1} y1={(height - h) / 2} y2={(height + h) / 2} stroke={i <= active ? c.accent : c.line} strokeWidth={major ? 2 : 1.4} />;
          })}
          <Line x1={active * TICK + 1} x2={active * TICK + 1} y1={1} y2={height - 1} stroke={c.text} strokeWidth={2.5} />
        </Svg>
      </View>
    </View>
  );
}

export function MiniPlayer() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const path = usePathname();
  const cur = usePlayer((p) => p.current);
  const src = usePlayer((p) => p.source);
  const playing = usePlayer((p) => p.playing);
  const buffering = usePlayer((p) => p.buffering);
  const progress = usePlayer((p) => (p.durationSec ? p.positionSec / p.durationSec : 0));
  const start = useRef<number | null>(null);
  if (!cur || ['/player', '/queue', '/lyrics', '/onboarding'].includes(path)) return null;
  const inTabs = ['/', '/search', '/library', '/profile'].includes(path);
  return (
    <View style={{ position: 'absolute', left: 8, right: 8, bottom: (inTabs ? TAB_HEIGHT : 0) + insets.bottom + 6, backgroundColor: c.raised, borderRadius: 4, overflow: 'hidden' }}>
      <Pressable testID="mini-player" accessibilityRole="button" accessibilityLabel={`Открыть плеер: ${cur.title}`} onPress={() => router.push('/player')}
        onTouchStart={(e) => { start.current = e.nativeEvent.pageX; }}
        onTouchEnd={(e) => { const d = start.current === null ? 0 : e.nativeEvent.pageX - start.current; start.current = null; if (d < -70) void player.next(); else if (d > 70) void player.previous(); }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 7 }}>
        <Cover uri={cur.coverUrl ?? src?.coverUrl} title={cur.artist} size={42} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <T v="title" numberOfLines={1}>{cur.title}</T>
          <T v="small" c="muted" numberOfLines={1}>{buffering ? 'Загружается…' : `${cur.artist}${src ? `, ${sourceName(src.source)}` : ''}`}</T>
        </View>
        <IconBtn testID="mini-toggle" name={playing ? 'pause' : 'play'} label={playing ? 'Пауза' : 'Играть'} onPress={() => player.toggle()} />
        <IconBtn name="next" label="Следующий трек" onPress={() => void player.next()} />
      </Pressable>
      <View style={{ height: 2, backgroundColor: c.line }}><View style={{ height: 2, width: `${progress * 100}%`, backgroundColor: c.accent }} /></View>
    </View>
  );
}

function SheetAction({ icon, label, onPress, tone }: { icon: IconName; label: string; onPress: () => void; tone?: 'accent' | 'danger' }) {
  const c = useColors();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => ({ flexDirection: 'row', gap: 14, alignItems: 'center', minHeight: 46, opacity: pressed ? 0.55 : 1 })}>
      <Icon name={icon} size={21} color={tone ? c[tone] : c.muted} /><T v="strong" c={tone ?? 'text'} style={{ flex: 1 }}>{label}</T>
    </Pressable>
  );
}

const go = (fn: () => void) => { closeSheet(); setTimeout(fn, 30); };

export function TrackSheet() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const t = useUi((u) => u.sheetTrack);
  const [mode, setMode] = useState<'main' | 'playlist'>('main');
  const [lists, setLists] = useState<Awaited<ReturnType<typeof repo.listPlaylists>>>([]);
  const close = () => { setMode('main'); closeSheet(); };
  if (!t) return null;
  const src = t.preferred;
  const playable = src?.availability === 'full' && !!adapter(src.source)?.resolveStream;
  const react = async (kind: 'like' | 'dislike' | 'more' | 'less' | 'hide', msg: string) => {
    const on = kind === 'like' ? !t.liked : true;
    await applyFeedback(t.id, kind, on); bumpData(); player.invalidate(t.id); close(); toast(kind === 'like' && !on ? 'Убрано из любимого' : msg);
  };
  const external = t.sources.map((s) => ({ name: sourceName(s.source), url: adapter(s.source)?.externalUrl?.({ title: t.title, artist: t.artist, externalUrl: s.externalUrl }) })).filter((x) => x.url);
  const offlineSrc = t.sources.find((s) => s.canOffline && !s.localPath && adapter(s.source)?.capabilities.canOffline);
  return (
    <Modal transparent visible animationType="slide" onRequestClose={close} statusBarTranslucent>
      <Pressable accessibilityLabel="Закрыть меню" style={{ flex: 1, backgroundColor: '#0008' }} onPress={close} />
      <View style={{ backgroundColor: c.raised, maxHeight: '82%', paddingBottom: insets.bottom + 8, borderTopLeftRadius: 8, borderTopRightRadius: 8 }}>
        <ScrollView contentContainerStyle={{ padding: 20 }}>
          <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center', marginBottom: 12 }}>
            <Cover uri={t.coverUrl} title={t.artist} size={58} />
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
            <SheetAction icon={t.liked ? 'heartOn' : 'heart'} tone={t.liked ? 'accent' : undefined} label={t.liked ? 'Убрать из любимого' : 'В любимое'} onPress={() => void react('like', 'Добавлено в любимое')} />
            <SheetAction icon="plus" label="Добавить в плейлист" onPress={async () => { setLists((await repo.listPlaylists()).filter((p) => !p.smartRule)); setMode('playlist'); }} />
            <SheetAction icon="similar" label="Похожие композиции" onPress={() => go(() => router.push({ pathname: '/similar/[id]', params: { id: t.id } }))} />
            <SheetAction icon="radio" label="Создать радио по этой песне" onPress={() => go(() => void player.playList([{ trackId: t.id }], 0, `radio:${t.id}`))} />
            <SheetAction icon="fork" label="Перейти к исполнителю" onPress={() => go(() => router.push({ pathname: '/artist/[name]', params: { name: t.artist } }))} />
            {src?.albumId && adapter(src.source)?.albumTracks ? <SheetAction icon="cover" label="Перейти к альбому" onPress={() => go(() => router.push({ pathname: '/album/[source]/[id]', params: { source: src.source, id: src.albumId!, title: t.album ?? '' } }))} /> : null}
            <SheetAction icon="up" label="Больше такого" onPress={() => void react('more', 'Будет больше похожего')} />
            <SheetAction icon="down" label="Меньше такого" onPress={() => void react('less', 'Будет меньше похожего')} />
            <SheetAction icon="thumbDown" label="Не нравится" onPress={() => void react('dislike', 'Учтём это в рекомендациях')} />
            <SheetAction icon="close" label="Скрыть из рекомендаций" onPress={() => void react('hide', 'Трек больше не появится')} />
            {offlineSrc ? <SheetAction icon="down" label="Сохранить на телефон" onPress={async () => {
              close(); toast('Сохраняем…');
              try { const r = await resolveStream(offlineSrc); const f = await downloadToApp(r.uri, `${offlineSrc.id.replace(/[^\w.-]+/g, '_')}.audio`); await repo.addDownload(offlineSrc.id, f.uri, f.size); bumpData(); toast('Сохранено на телефон'); }
              catch (e) { toast((e as Error).message); }
            }} /> : null}
            {external.slice(0, 2).map((e) => <SheetAction key={e.url} icon="link" label={`Открыть в ${e.name}`} onPress={() => { void Linking.openURL(e.url!); close(); }} />)}
            {linkAdapters().filter((a) => ['yandex', 'vk', 'spotify'].includes(a.id)).map((a) => <SheetAction key={a.id} icon="link" label={`Найти в ${a.name}`} onPress={() => { void Linking.openURL(a.externalUrl!({ title: t.title, artist: t.artist })!); close(); }} />)}
            <SheetAction icon="share" label="Поделиться" onPress={() => { close(); void Share.share({ message: `${t.artist} — ${t.title}${src?.externalUrl ? `\n${src.externalUrl}` : ''}` }); }} />
          </>}
        </ScrollView>
      </View>
    </Modal>
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
        return (
          <Pressable key={s.id} accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={() => onPick(s)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7 }}>
            <View style={{ width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: on ? c.accent : c.line, backgroundColor: on ? c.accent : 'transparent' }} />
            <View style={{ flex: 1 }}>
              <T v="strong">{sourceName(s.source)}</T>
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
  return <View accessibilityLiveRegion="polite" pointerEvents="none" style={{ position: 'absolute', top: insets.top, left: 0, right: 0, backgroundColor: c.warn, paddingVertical: 4, paddingHorizontal: 20 }}><Text style={[TYPE.small, { color: c.bg }]}>Нет интернета. Работают файлы на телефоне и сохранённое.</Text></View>;
}

export function Toast() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const text = useUi((u) => u.toast);
  if (!text) return null;
  return <View pointerEvents="none" accessibilityLiveRegion="polite" style={{ position: 'absolute', top: insets.top + 8, left: 16, right: 16, backgroundColor: c.text, padding: 12, borderRadius: 4 }}><Text style={[TYPE.strong, { color: c.bg }]}>{text}</Text></View>;
}
