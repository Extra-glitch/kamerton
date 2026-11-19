import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { AppState, Linking, Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import WebView from 'react-native-webview';
import { effectiveExplicit } from '@/core/choose';
import { formatDuration } from '@/core/text';
import { explicitLabel, parseTitle, versionLabel } from '@/core/versions';
import * as repo from '@/db/repo';
import { BUCKET_LABEL } from '@/reco/engine';
import { loadVideo } from '@/services/media';
import { applyFeedback } from '@/services/reco';
import { displayCover } from '@/sources/subsonic';
import { adapter, LISTEN_ELSEWHERE, playMode, sourceName } from '@/sources/registry';
import { parseYouTubeId } from '@/sources/youtube';
import { bumpData, openSheet, player, toast, usePlayer } from '@/state/app';
import { useSettings } from '@/state/settings';
import { Ambient, useMotion } from '@/ui/ambient';
import { Glass } from '@/ui/glass';
import { Badge, Btn, Chip, Cover, Field, IconBtn, Notice, Press, RoundBtn, T } from '@/ui/kit';
import { Dial, PlayOrb, qualityText } from '@/ui/music';
import { useColors } from '@/ui/theme';

const CONTEXT: [string, string][] = [['preview', 'Фрагменты'], ['wave', 'Волна'], ['surprise', 'Удиви меня'], ['radio:', 'Радио по песне'], ['daily', 'Открытия дня'], ['dj', 'Умный DJ'], ['search', 'Поиск'], ['library', 'Коллекция'], ['playlist', 'Плейлист'], ['radio-station', 'Интернет-радио']];
const SLEEP = [15, 30, 60];

function youtubeHtml(id: string) {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="strict-origin-when-cross-origin"><style>html,body{margin:0;height:100%;background:#000}iframe{border:0;width:100%;height:100%}</style></head><body><iframe src="https://www.youtube-nocookie.com/embed/${id}?playsinline=1&rel=0" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></body></html>`;
}

export default function Player() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const reduced = useReducedMotion();
  const t = usePlayer((p) => p.current);
  const src = usePlayer((p) => p.source);
  const playing = usePlayer((p) => p.playing);
  const buffering = usePlayer((p) => p.buffering);
  const pos = usePlayer((p) => p.positionSec);
  const dur = usePlayer((p) => p.durationSec);
  const shuffle = usePlayer((p) => p.shuffle);
  const repeat = usePlayer((p) => p.repeat);
  const ctx = usePlayer((p) => p.context);
  const error = usePlayer((p) => p.error);
  const sleepAt = usePlayer((p) => p.sleepAt);
  const volume = usePlayer((p) => p.volume);
  const setSetting = useSettings((s) => s.set);
  const item = usePlayer((p) => p.queue[p.index]);
  const videoOn = useSettings((s) => s.videoEnabled);
  const [view, setView] = useState<'cover' | 'video'>('cover');
  const [seekShown, setSeekShown] = useState<number | null>(null);
  const [link, setLink] = useState('');
  const [active, setActive] = useState(AppState.currentState === 'active');
  const [sleepOpen, setSleepOpen] = useState(false);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const tx = useSharedValue(0);
  const motion = useMotion();
  const coverScale = useSharedValue(1);
  const likeScale = useSharedValue(1);
  useEffect(() => { coverScale.value = motion ? withSpring(playing || buffering ? 1 : 0.86, { damping: 16, stiffness: 140 }) : 1; }, [playing, buffering, motion, coverScale]);
  useEffect(() => { const sub = AppState.addEventListener('change', (st) => { setActive(st === 'active'); }); return () => sub.remove(); }, []);
  useEffect(() => { setView('cover'); }, [t?.id]);
  const rec = useQuery({ queryKey: ['why', t?.id], queryFn: () => repo.lastRecommendation(t!.id), enabled: !!t });
  const video = useQuery({ queryKey: ['video', t?.id, videoOn], queryFn: () => loadVideo(t!), enabled: !!t && videoOn && view === 'video', staleTime: Infinity });
  const coverW = Math.min(width - 40, 520);
  const pan = Gesture.Pan().activeOffsetX([-16, 16]).failOffsetY([-14, 14])
    .onUpdate((e) => { tx.value = e.translationX; })
    .onEnd((e) => {
      const go = Math.abs(e.translationX) > 90;
      if (go) runOnJS(e.translationX < 0 ? skipNext : skipPrev)();
      tx.value = reduced ? withTiming(0, { duration: 0 }) : withSpring(0, { damping: 20, stiffness: 180 });
    });
  const coverStyle = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value * 0.7 }, { scale: coverScale.value }] }));
  const likeStyle = useAnimatedStyle(() => ({ transform: [{ scale: likeScale.value }] }));

  if (!t) return <View style={{ flex: 1, backgroundColor: c.bg, padding: 24, paddingTop: insets.top + 24 }}><Ambient /><T v="h1">Ничего не играет</T><Btn label="Закрыть" kind="line" onPress={() => router.back()} style={{ marginTop: 16 }} /></View>;
  const art = displayCover(t.coverUrl ?? src?.coverUrl);
  const preview = src ? playMode(src) === 'preview' : false;
  const live = !!src?.isLive;
  const state = src ? effectiveExplicit(src) : 'unknown';
  const tags = parseTitle(t.title).versionTags.filter((v) => v !== 'explicit_marked');
  const q = qualityText(src?.quality);
  const name = CONTEXT.find(([k]) => ctx.startsWith(k))?.[1] ?? 'Сейчас играет';
  const shownPos = seekShown ?? pos;
  const openVideo = () => { player.pause(); setView('video'); }; // у клипа свой звук, два потока не смешиваем
  const react = async (kind: 'more' | 'less' | 'dislike', msg: string) => { await applyFeedback(t.id, kind); bumpData(); toast(msg); if (kind === 'dislike') void player.next(); };

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Ambient animate />
      {art ? <Image source={art} blurRadius={Platform.OS === 'android' ? 25 : 60} contentFit="cover" transition={400} style={[StyleSheet.absoluteFill, { opacity: 0.55 }]} accessibilityIgnoresInvertColors /> : null}
      <LinearGradient colors={['rgba(0,0,0,0)', c.bg]} locations={[0.15, 0.85]} style={StyleSheet.absoluteFill} />
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + 26 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, gap: 8 }}>
          <RoundBtn testID="player-close" name="down" label="Свернуть плеер" onPress={() => router.back()} />
          <T v="strong" c="muted" style={{ flex: 1, textAlign: 'center' }} numberOfLines={1}>{name}</T>
          <RoundBtn name="more" label="Действия с треком" onPress={() => openSheet(t)} />
        </View>
        <View style={{ paddingHorizontal: 20 }}>
          {view === 'cover' ? (
            <GestureDetector gesture={pan}>
              <Animated.View style={[{ alignSelf: 'center', width: coverW, marginTop: 14, borderRadius: 28, elevation: 18, shadowColor: '#000', shadowOpacity: 0.45, shadowRadius: 26, shadowOffset: { width: 0, height: 14 } }, coverStyle]}><Cover uri={t.coverUrl ?? src?.coverUrl} title={t.artist} size={coverW} radius={28} /></Animated.View>
            </GestureDetector>
          ) : (
            <View style={{ width: coverW, alignSelf: 'center', marginTop: 6 }}>
              {video.data && active && Platform.OS !== 'web' ? <View style={{ width: coverW, height: coverW * 9 / 16, backgroundColor: '#000' }}><WebView source={{ html: youtubeHtml(video.data.videoId), baseUrl: 'https://kamerton.app' }} allowsFullscreenVideo mediaPlaybackRequiresUserAction /></View> : null}
              {video.data ? <T v="small" c="muted" style={{ marginTop: 6 }}>Клип найден через {video.data.origin}. Играет со своим звуком в плеере YouTube.</T> : null}
              {video.isLoading ? <T c="muted">Ищем официальный клип…</T> : null}
              {!video.isLoading && !video.data ? <View style={{ paddingVertical: 12 }}>
                <T v="h3">Клип не найден</T>
                <T v="small" c="muted" style={{ marginVertical: 6 }}>Автопоиск работает с ключом YouTube или данными MusicBrainz. Если знаете официальный клип, вставьте ссылку.</T>
                <Field placeholder="Ссылка на YouTube" value={link} onChangeText={setLink} autoCapitalize="none" />
                <Btn label="Привязать клип" kind="line" disabled={!parseYouTubeId(link)} onPress={async () => { await repo.setVideo(t.id, { provider: 'youtube', videoId: parseYouTubeId(link)!, origin: 'ваша ссылка' }); setLink(''); void video.refetch(); }} />
              </View> : null}
            </View>
          )}

          <Pressable onPress={() => router.push({ pathname: '/artist/[name]', params: { name: t.artist, ...(src?.source === 'deezer' && src.artistId ? { deezer: src.artistId } : {}) } })} accessibilityRole="link" style={{ marginTop: 22 }}>
            <T v="h1" numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.7}>{t.title}</T>
            <T v="title" c="muted" numberOfLines={1} style={{ marginTop: 4 }}>{t.artist}{t.album ? `, ${t.album}` : ''}</T>
          </Pressable>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 8 }}>
            {preview ? <Badge label="фрагмент 30 с" tone="warn" /> : null}
            {state === 'explicit' ? <Badge label="E" tone="muted" /> : null}
            {state === 'clean' || tags.includes('radio_edit') ? <Badge label={state === 'clean' ? 'с цензурой' : 'радиоверсия'} tone="warn" /> : null}
            <T v="small" c="faint" style={{ flexShrink: 1 }}>{src ? sourceName(src.source) : ''}{q ? `, ${q}` : ''}</T>
          </View>
          <T v="small" c={state === 'clean' || tags.includes('radio_edit') ? 'warn' : state === 'unknown' ? 'faint' : 'muted'}>{explicitLabel(state, tags)}{tags.filter((x) => x !== 'clean' && x !== 'radio_edit').length ? `, ${tags.filter((x) => x !== 'clean' && x !== 'radio_edit').map(versionLabel).join(', ').toLowerCase()}` : ''}</T>
          {src?.attribution ? <T v="small" c="faint">{src.attribution}</T> : null}
          {preview ? <Glass radius={18} style={{ padding: 12, marginTop: 10 }}>
            <T v="small" c="muted">Это фрагмент. Полностью песню можно послушать по подписке:</T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
              {LISTEN_ELSEWHERE.map((id) => adapter(id)).filter((a) => a?.externalUrl).map((a) => <Chip key={a!.id} icon="link" label={a!.name} onPress={() => { player.pause(); void Linking.openURL(a!.externalUrl!({ title: t.title, artist: t.artist })!); }} />)}
            </View>
          </Glass> : null}
          {error ? <Notice tone="danger" text={error} /> : null}

          {live ? <T v="h3" c="accent" style={{ marginTop: 18 }}>Прямой эфир</T> : (
            <View style={{ marginTop: 14 }}>
              <Dial testID="seek" label="Позиция в треке" value={dur ? shownPos / dur : 0} onChange={(v) => setSeekShown(v * dur)} onCommit={(v) => { setSeekShown(null); void player.seek(v * dur); }} disabled={!dur} />
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><T v="small" c="muted">{formatDuration(shownPos)}</T><T v="small" c="muted">{buffering ? 'Загружается…' : formatDuration(dur)}</T></View>
            </View>
          )}

          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
            <IconBtn name="shuffle" label="Перемешивание" active={shuffle} onPress={() => void player.setShuffle(!shuffle)} />
            <IconBtn name="prev" label="Предыдущий" size={34} onPress={() => void player.previous()} />
            <PlayOrb testID="player-toggle" label={playing ? 'Пауза' : 'Играть'} playing={playing} size={78} onPress={() => player.toggle()} />
            <IconBtn testID="player-next" name="next" label="Следующий" size={34} onPress={() => void player.next()} />
            <IconBtn name={repeat === 'one' ? 'repeatOne' : 'repeat'} label={repeat === 'off' ? 'Повтор выключен' : repeat === 'all' ? 'Повтор очереди' : 'Повтор трека'} active={repeat !== 'off'} onPress={() => player.cycleRepeat()} />
          </View>

          <Glass radius={24} style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 14, paddingHorizontal: 4 }}>
            <Animated.View style={likeStyle}><IconBtn testID="player-like" name={t.liked ? 'heartOn' : 'heart'} label={t.liked ? 'Убрать из любимого' : 'В любимое'} active={t.liked} onPress={async () => { if (!t.liked && motion) likeScale.value = withSequence(withTiming(1.35, { duration: 120 }), withSpring(1, { damping: 8, stiffness: 220 })); await applyFeedback(t.id, 'like', !t.liked); bumpData(); player.invalidate(t.id); }} /></Animated.View>
            <IconBtn name="plus" label="Добавить в плейлист" onPress={() => openSheet(t)} />
            <IconBtn testID="player-lyrics" name="lyrics" label="Текст песни" onPress={() => router.push('/lyrics')} disabled={live} />
            {videoOn ? <IconBtn name={view === 'video' ? 'cover' : 'video'} label={view === 'video' ? 'Показать обложку' : 'Показать клип'} active={view === 'video'} onPress={() => (view === 'video' ? setView('cover') : openVideo())} disabled={live} /> : null}
            <IconBtn name="similar" label="Похожие композиции" onPress={() => router.push({ pathname: '/similar/[id]', params: { id: t.id } })} disabled={live} />
            <IconBtn name="timer" label="Таймер сна" active={!!sleepAt} onPress={() => setSleepOpen((v) => !v)} />
            <IconBtn name="volume" label="Громкость" active={volumeOpen} onPress={() => setVolumeOpen((v) => !v)} />
            <IconBtn testID="player-queue" name="queue" label="Очередь" onPress={() => router.push('/queue')} />
          </Glass>
          {volumeOpen ? <View style={{ marginTop: 6 }}>
            <Dial label="Громкость плеера" value={volume} height={32} onChange={(v) => player.setUserVolume(v)} onCommit={(v) => { player.setUserVolume(v); setSetting({ volume: v }); }} />
            <T v="small" c="muted">Громкость в приложении: {Math.round(volume * 100)}%</T>
          </View> : null}
          {sleepOpen ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
            {SLEEP.map((m) => <Chip key={m} label={`${m} мин`} onPress={() => { player.setSleepTimer(m); setSleepOpen(false); toast(`Остановим через ${m} минут`); }} />)}
            {sleepAt ? <Chip label="Отключить" onPress={() => { player.setSleepTimer(null); setSleepOpen(false); }} /> : null}
          </View> : null}

          {item?.reason || rec.data ? <Glass radius={18} style={{ marginTop: 16, padding: 14 }}>
            <T v="strong">Почему этот трек</T>
            <T v="small" c="muted">{item?.reason ?? rec.data?.reason}{rec.data ? `. ${BUCKET_LABEL[rec.data.bucket as keyof typeof BUCKET_LABEL] ?? ''}` : ''}</T>
          </Glass> : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
            <Chip testID="more-like" label="Больше такого" onPress={() => void react('more', 'Будет больше похожего')} />
            <Chip label="Меньше такого" onPress={() => void react('less', 'Будет меньше похожего')} />
            <Chip label="Не нравится" onPress={() => void react('dislike', 'Пропускаем и запоминаем')} />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function skipNext() { void player.next(); }
function skipPrev() { void player.previous(); }
