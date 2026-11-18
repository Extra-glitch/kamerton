import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { AppState, Platform, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import WebView from 'react-native-webview';
import { effectiveExplicit } from '@/core/choose';
import { formatDuration } from '@/core/text';
import { explicitLabel, parseTitle, versionLabel } from '@/core/versions';
import * as repo from '@/db/repo';
import { BUCKET_LABEL } from '@/reco/engine';
import { loadVideo } from '@/services/media';
import { applyFeedback } from '@/services/reco';
import { sourceName } from '@/sources/registry';
import { parseYouTubeId } from '@/sources/youtube';
import { bumpData, openSheet, player, toast, usePlayer } from '@/state/app';
import { useSettings } from '@/state/settings';
import { Icon } from '@/ui/icons';
import { Btn, Chip, Cover, Field, IconBtn, Notice, T } from '@/ui/kit';
import { Dial, qualityText } from '@/ui/music';
import { useColors } from '@/ui/theme';

const CONTEXT: [string, string][] = [['wave', 'Волна'], ['surprise', 'Удиви меня'], ['radio:', 'Радио по песне'], ['daily', 'Открытия дня'], ['dj', 'Умный DJ'], ['search', 'Поиск'], ['library', 'Коллекция'], ['playlist', 'Плейлист'], ['radio-station', 'Интернет-радио']];
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
  const coverStyle = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value * 0.7 }] }));

  if (!t) return <View style={{ flex: 1, backgroundColor: c.bg, padding: 24, paddingTop: insets.top + 24 }}><T v="h1">Ничего не играет</T><Btn label="Закрыть" kind="line" onPress={() => router.back()} style={{ marginTop: 16 }} /></View>;
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
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 4, paddingBottom: insets.bottom + 26 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8 }}>
          <IconBtn testID="player-close" name="down" label="Свернуть плеер" onPress={() => router.back()} />
          <T v="strong" c="muted" style={{ flex: 1, textAlign: 'center' }} numberOfLines={1}>{name}</T>
          <IconBtn name="more" label="Действия с треком" onPress={() => openSheet(t)} />
        </View>
        <View style={{ paddingHorizontal: 20 }}>
          {view === 'cover' ? (
            <GestureDetector gesture={pan}>
              <Animated.View style={[{ alignSelf: 'center', width: coverW, marginTop: 6 }, coverStyle]}><Cover uri={t.coverUrl ?? src?.coverUrl} title={t.artist} size={coverW} radius={4} /></Animated.View>
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

          <Pressable onPress={() => router.push({ pathname: '/artist/[name]', params: { name: t.artist } })} accessibilityRole="link" style={{ marginTop: 16 }}>
            <T v="h1" numberOfLines={3} adjustsFontSizeToFit minimumFontScale={0.7}>{t.title}</T>
            <T v="title" c="muted" numberOfLines={1} style={{ marginTop: 3 }}>{t.artist}{t.album ? `, ${t.album}` : ''}</T>
          </Pressable>
          <T v="small" c="faint" style={{ marginTop: 5 }}>{src ? sourceName(src.source) : ''}{q ? `, ${q}` : ''}</T>
          <T v="small" c={state === 'clean' || tags.includes('radio_edit') ? 'warn' : state === 'unknown' ? 'faint' : 'muted'}>{explicitLabel(state, tags)}{tags.filter((x) => x !== 'clean' && x !== 'radio_edit').length ? `, ${tags.filter((x) => x !== 'clean' && x !== 'radio_edit').map(versionLabel).join(', ').toLowerCase()}` : ''}</T>
          {src?.attribution ? <T v="small" c="faint">{src.attribution}</T> : null}
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
            <Pressable testID="player-toggle" accessibilityRole="button" accessibilityLabel={playing ? 'Пауза' : 'Играть'} onPress={() => player.toggle()} style={{ width: 76, height: 76, borderRadius: 38, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={playing ? 'pause' : 'play'} size={36} color={c.onAccent} />
            </Pressable>
            <IconBtn testID="player-next" name="next" label="Следующий" size={34} onPress={() => void player.next()} />
            <IconBtn name={repeat === 'one' ? 'repeatOne' : 'repeat'} label={repeat === 'off' ? 'Повтор выключен' : repeat === 'all' ? 'Повтор очереди' : 'Повтор трека'} active={repeat !== 'off'} onPress={() => player.cycleRepeat()} />
          </View>

          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
            <IconBtn testID="player-like" name={t.liked ? 'heartOn' : 'heart'} label={t.liked ? 'Убрать из любимого' : 'В любимое'} active={t.liked} onPress={async () => { await applyFeedback(t.id, 'like', !t.liked); bumpData(); player.invalidate(t.id); }} />
            <IconBtn name="plus" label="Добавить в плейлист" onPress={() => openSheet(t)} />
            <IconBtn testID="player-lyrics" name="lyrics" label="Текст песни" onPress={() => router.push('/lyrics')} disabled={live} />
            {videoOn ? <IconBtn name={view === 'video' ? 'cover' : 'video'} label={view === 'video' ? 'Показать обложку' : 'Показать клип'} active={view === 'video'} onPress={() => (view === 'video' ? setView('cover') : openVideo())} disabled={live} /> : null}
            <IconBtn name="similar" label="Похожие композиции" onPress={() => router.push({ pathname: '/similar/[id]', params: { id: t.id } })} disabled={live} />
            <IconBtn name="timer" label="Таймер сна" active={!!sleepAt} onPress={() => setSleepOpen((v) => !v)} />
            <IconBtn name="volume" label="Громкость" active={volumeOpen} onPress={() => setVolumeOpen((v) => !v)} />
            <IconBtn testID="player-queue" name="queue" label="Очередь" onPress={() => router.push('/queue')} />
          </View>
          {volumeOpen ? <View style={{ marginTop: 6 }}>
            <Dial label="Громкость плеера" value={volume} height={32} onChange={(v) => player.setUserVolume(v)} onCommit={(v) => { player.setUserVolume(v); setSetting({ volume: v }); }} />
            <T v="small" c="muted">Громкость в приложении: {Math.round(volume * 100)}%</T>
          </View> : null}
          {sleepOpen ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
            {SLEEP.map((m) => <Chip key={m} label={`${m} мин`} onPress={() => { player.setSleepTimer(m); setSleepOpen(false); toast(`Остановим через ${m} минут`); }} />)}
            {sleepAt ? <Chip label="Отключить" onPress={() => { player.setSleepTimer(null); setSleepOpen(false); }} /> : null}
          </View> : null}

          {item?.reason || rec.data ? <View style={{ marginTop: 18 }}>
            <T v="strong">Почему этот трек</T>
            <T v="small" c="muted">{item?.reason ?? rec.data?.reason}{rec.data ? `. ${BUCKET_LABEL[rec.data.bucket as keyof typeof BUCKET_LABEL] ?? ''}` : ''}</T>
          </View> : null}
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
