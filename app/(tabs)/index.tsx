import { useQuery } from '@tanstack/react-query';
import { Redirect, router, useIsFocused } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { TrackView } from '@/core/types';
import { friendlyError } from '@/net/http';
import { loadHome, nextWave, refreshPool, surpriseMe } from '@/services/reco';
import { player, toast, useUi, usePlayer } from '@/state/app';
import { useSettings } from '@/state/settings';
import { Icon } from '@/ui/icons';
import { Btn, Cover, Empty, Loading, Notice, Section, Shelf, T } from '@/ui/kit';
import { Dial, playOrOpen, TrackList } from '@/ui/music';
import { BOTTOM_PAD, SPACE, TYPE, useColors } from '@/ui/theme';

function Poster({ t, tracks, i, context }: { t: TrackView; tracks: TrackView[]; i: number; context: string }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${t.title}, ${t.artist}`} onPress={() => playOrOpen(tracks, i, context)} style={{ width: 148 }}>
      <Cover uri={t.coverUrl} title={t.artist} size={148} />
      <T v="title" numberOfLines={1} style={{ marginTop: 7 }}>{t.title}</T>
      <T v="small" c="muted" numberOfLines={1}>{t.artist}</T>
    </Pressable>
  );
}

const MODES = [{ at: 0.1, label: 'Больше знакомого' }, { at: 0.5, label: 'Баланс' }, { at: 0.9, label: 'Больше открытий' }];

export default function Home() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const onboarded = useSettings((s) => s.onboarded);
  const discovery = useSettings((s) => s.discovery);
  const setS = useSettings((s) => s.set);
  const version = useUi((u) => u.dataVersion + u.playVersion);
  const focused = useIsFocused();
  const seenVersion = useRef(version);
  const inWave = usePlayer((p) => p.context === 'wave' && p.playing);
  const [busy, setBusy] = useState<'wave' | 'surprise' | null>(null);
  const q = useQuery({ queryKey: ['home', onboarded], queryFn: loadHome, enabled: onboarded, staleTime: 120_000 });
  // Лента не перестраивается под пальцами: обновляем её, когда пользователь возвращается на экран.
  useEffect(() => {
    if (focused && seenVersion.current !== version) { seenVersion.current = version; void q.refetch(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused]);
  if (!onboarded) return <Redirect href="/onboarding" />;
  const d = q.data;

  const launch = async (kind: 'wave' | 'surprise') => {
    setBusy(kind);
    try {
      const list = kind === 'wave' ? await nextWave(15) : await surpriseMe(12);
      if (!list.length) toast('Пока нечего включить. Проверьте интернет или подключите источник.');
      else await player.playList(list, 0, kind);
    } catch (e) { toast(friendlyError(e)); } finally { setBusy(null); }
  };
  const mode = MODES.reduce((a, b) => (Math.abs(b.at - discovery) < Math.abs(a.at - discovery) ? b : a));

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: SPACE.page, paddingBottom: BOTTOM_PAD }}
      refreshControl={<RefreshControl tintColor={c.accent} refreshing={q.isRefetching} onRefresh={async () => { await refreshPool(true).catch(() => undefined); await q.refetch(); }} />}>
      <Pressable testID="wave-play" accessibilityRole="button" accessibilityLabel="Включить волну" onPress={() => void launch('wave')} disabled={!!busy} style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <T v="poster" adjustsFontSizeToFit numberOfLines={1} style={{ flex: 1, marginLeft: -3, marginRight: 12 }}>{busy === 'wave' ? 'Ловим…' : 'Волна'}</T>
        <View style={{ width: 66, height: 66, borderRadius: 33, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
          <Icon name={inWave ? 'pause' : 'play'} size={32} color={c.onAccent} />
        </View>
      </Pressable>
      <View style={{ marginTop: 10 }}>
        <Dial testID="discovery-dial" label="Сколько новой музыки в волне" value={discovery} height={36} onCommit={(v) => setS({ discovery: v })} />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 3 }}>
          <T v="small" c="muted">Знакомое</T><T v="small" c="text">{mode.label}</T><T v="small" c="muted">Новое</T>
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
        <Btn testID="surprise" label="Удиви меня" kind="line" busy={busy === 'surprise'} onPress={() => void launch('surprise')} style={{ flex: 1 }} />
        <Btn label="Открытия дня" kind="line" onPress={() => router.push('/discoveries')} style={{ flex: 1 }} />
      </View>

      {q.isLoading ? <Loading label="Смотрим, что есть в подключённых источниках" /> : null}
      {q.isError ? <Notice tone="danger" text={friendlyError(q.error)} /> : null}
      {d?.poolErrors.length ? <Notice tone="warn" text={`Не ответили: ${d.poolErrors.map((e) => e.source).join(', ')}. Показываем то, что удалось получить.`} /> : null}

      {d && !d.poolSize ? <Empty title="Пока тихо" text="Источники не вернули музыку. Проверьте интернет или подключите свои файлы, сервер или каталог." action="Открыть источники" onAction={() => router.push('/sources')} /> : null}

      {d?.waveTracks.length ? <View style={{ marginTop: 26 }}>
        <T v="small" c="muted" style={{ marginBottom: 3 }}>Дальше в волне</T>
        {d.waveTracks.slice(0, 3).map((t, i) => (
          <Pressable key={t.id} accessibilityRole="button" onPress={() => void player.playList(d.wave, i, 'wave')} style={{ paddingVertical: 4 }}>
            <T v="h2" numberOfLines={1}>{t.title}</T>
            <T v="small" c="muted" numberOfLines={1}>{t.artist}</T>
            <T v="small" c="faint" numberOfLines={1}>{d.wave[i].reason}</T>
          </Pressable>
        ))}
      </View> : null}

      {d?.recent.length ? <Section title="Продолжить" action={{ label: 'История', onPress: () => router.push('/history') }}><Shelf>{d.recent.slice(0, 10).map((t, i) => <Poster key={t.id} t={t} tracks={d.recent} i={i} context="recent" />)}</Shelf></Section> : null}
      {d?.daily.length ? <Section title="Открытия дня" note="Этого вы ещё не слышали. Завтра будет новый набор."><TrackList tracks={d.daily.slice(0, 4)} context="daily" notes={d.dailyReasons} /></Section> : null}
      {d?.likeRecent ? <Section title={`Похоже на «${d.likeRecent.title}»`}><Shelf>{d.likeRecent.tracks.map((t, i) => <Poster key={t.id} t={t} tracks={d.likeRecent!.tracks} i={i} context="similar" />)}</Shelf></Section> : null}
      {d?.artists.length ? <Section title="Ваши исполнители">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 16 }}>
          {d.artists.map((a) => <Pressable key={a.name} accessibilityRole="link" onPress={() => router.push({ pathname: '/artist/[name]', params: { name: a.name } })}><T style={TYPE.h3}>{a.name}</T></Pressable>)}
        </View>
      </Section> : null}
      {d?.albums.length ? <Section title="Альбомы для вас"><Shelf>{d.albums.map((a) => (
        <Pressable key={`${a.source}${a.id}`} accessibilityRole="button" onPress={() => router.push({ pathname: '/album/[source]/[id]', params: { source: a.source, id: a.id, title: a.title } })} style={{ width: 190 }}>
          <Cover uri={a.cover} title={a.title} size={190} /><T v="h3" numberOfLines={2} style={{ marginTop: 7 }}>{a.title}</T><T v="small" c="muted" numberOfLines={1}>{a.artist}</T>
        </Pressable>))}</Shelf></Section> : null}
      {d?.fresh.length ? <Section title="Новые релизы" action={{ label: 'Любимые исполнители', onPress: () => router.push('/releases') }}><TrackList tracks={d.fresh.slice(0, 4)} context="fresh" /></Section> : null}
      {d?.mixes.map((m) => <Section key={m.tag} title={`Подборка: ${m.tag}`}><Shelf>{m.tracks.map((t, i) => <Poster key={t.id} t={t} tracks={m.tracks} i={i} context={`mix:${m.tag}`} />)}</Shelf></Section>)}
      {d?.genrePopular.length ? <Section title="Популярное в ваших жанрах"><TrackList tracks={d.genrePopular.slice(0, 5)} context="popular" /></Section> : null}
      {d && d.interactions < 8 ? <T v="small" c="muted" style={{ marginTop: 30 }}>Рекомендации пока приблизительные. Они уточняются с каждым лайком, пропуском и дослушанным треком.</T> : null}
    </ScrollView>
  );
}
