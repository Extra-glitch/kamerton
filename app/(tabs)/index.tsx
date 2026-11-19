import { useYouTubeReady } from '@/services/fullVersion';
import { useQuery } from '@tanstack/react-query';
import { Redirect, router, useIsFocused } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { TrackView } from '@/core/types';
import { friendlyError } from '@/net/http';
import { loadHome, nextWave, refreshPool, surpriseMe } from '@/services/reco';
import { player, toast, useUi, usePlayer } from '@/state/app';
import { useSettings } from '@/state/settings';
import { Ambient } from '@/ui/ambient';
import { Glass } from '@/ui/glass';
import { Btn, Cover, Empty, Loading, Notice, Press, Section, Shelf, T, useBottomPad } from '@/ui/kit';
import { Dial, playBadge, playOrOpen, PlayOrb, TrackList } from '@/ui/music';
import { SPACE } from '@/ui/theme';

function Poster({ t, tracks, i, context, size = 150 }: { t: TrackView; tracks: TrackView[]; i: number; context: string; size?: number }) {
  const b = playBadge(t.preferred, useYouTubeReady((y) => y.ready));
  return (
    <Press accessibilityRole="button" accessibilityLabel={`${t.title}, ${t.artist}`} onPress={() => playOrOpen(tracks, i, context)} style={{ width: size }}>
      <Cover uri={t.coverUrl} title={t.artist} size={size} radius={18} />
      <T v="title" numberOfLines={1} style={{ marginTop: 8 }}>{t.title}</T>
      <T v="small" c="muted" numberOfLines={1}>{b.tone === 'ok' ? t.artist : `${t.artist}, ${b.label}`}</T>
    </Press>
  );
}

const MODES = [{ at: 0.1, label: 'Больше знакомого' }, { at: 0.5, label: 'Баланс' }, { at: 0.9, label: 'Больше открытий' }];

export default function Home() {
  const bottomPad = useBottomPad();
  const insets = useSafeAreaInsets();
  const onboarded = useSettings((s) => s.onboarded);
  const discovery = useSettings((s) => s.discovery);
  const ownMusic = useSettings((s) => s.waveOwnMusic);
  const setS = useSettings((s) => s.set);
  const version = useUi((u) => u.dataVersion + u.playVersion);
  const focused = useIsFocused();
  const seenVersion = useRef(version);
  const inWave = usePlayer((p) => p.context === 'wave' && p.playing);
  const [busy, setBusy] = useState<'wave' | 'surprise' | null>(null);
  const off = useSettings((s) => s.disabledSources);
  const q = useQuery({ queryKey: ['home', onboarded, ownMusic, off.join(',')], queryFn: loadHome, enabled: onboarded, staleTime: 120_000 });
  // Лента не перестраивается под пальцами: обновляем её, когда пользователь возвращается на экран.
  useEffect(() => {
    if (focused && seenVersion.current !== version) { seenVersion.current = version; void q.refetch(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused]);
  if (!onboarded) return <Redirect href="/onboarding" />;
  const d = q.data;

  const launch = async (kind: 'wave' | 'surprise') => {
    if (kind === 'wave' && inWave) { player.toggle(); return; }
    setBusy(kind);
    try {
      const list = kind === 'wave' ? await nextWave(15) : await surpriseMe(12);
      if (!list.length) toast('Пока нечего включить. Проверьте интернет или подключите источник.');
      else await player.playList(list, 0, kind);
    } catch (e) { toast(friendlyError(e)); } finally { setBusy(null); }
  };
  const mode = MODES.reduce((a, b) => (Math.abs(b.at - discovery) < Math.abs(a.at - discovery) ? b : a));
  const next = d?.waveTracks[0];

  return (
    <View style={{ flex: 1 }}>
      <Ambient animate />
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 12, paddingHorizontal: SPACE.page, paddingBottom: bottomPad }}
        refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={async () => { await refreshPool(true).catch(() => undefined); await q.refetch(); }} />}>
        <Glass radius={30} style={{ padding: 20 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
            <View style={{ flex: 1 }}>
              <T v="poster" numberOfLines={1} adjustsFontSizeToFit>{busy === 'wave' ? 'Ловим…' : 'Волна'}</T>
              <T v="small" c={d?.waveError && !next ? 'warn' : 'muted'} numberOfLines={3} style={{ marginTop: 4 }}>{next ? `Дальше: ${next.artist} — ${next.title}` : d?.waveError ?? 'Музыка под ваш вкус, бесконечно'}</T>
            </View>
            <PlayOrb testID="wave-play" label={inWave ? 'Пауза' : 'Включить волну'} playing={inWave} busy={busy === 'wave'} onPress={() => void launch('wave')} />
          </View>
          <View style={{ marginTop: 18 }}>
            <Dial testID="discovery-dial" label="Сколько новой музыки в волне" value={discovery} height={34} onCommit={(v) => setS({ discovery: v })} />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
              <T v="small" c="faint">Знакомое</T><T v="small" c="accent">{mode.label}</T><T v="small" c="faint">Новое</T>
            </View>
            {/* Откуда волна берёт музыку: видно, если свои файлы подмешиваются или интернет-источников нет. */}
            <T testID="wave-sources" v="small" c="faint" style={{ marginTop: 8 }}>
              {d?.waveSources.length ? `Из интернета: ${d.waveSources.join(', ')}.` : 'Интернет-источников для волны нет.'}{' '}
              <T v="small" c="accent" accessibilityRole="switch" accessibilityState={{ checked: ownMusic }} onPress={() => setS({ waveOwnMusic: !ownMusic })}>
                {ownMusic ? 'Ваши файлы тоже в волне' : 'Ваши файлы не подмешиваются'}
              </T>
            </T>
          </View>
        </Glass>
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
          <Btn testID="surprise" label="Удиви меня" icon="sparkle" kind="line" busy={busy === 'surprise'} onPress={() => void launch('surprise')} style={{ flex: 1 }} />
          <Btn label="Открытия дня" icon="note" kind="line" onPress={() => router.push('/discoveries')} style={{ flex: 1 }} />
        </View>

        {q.isLoading ? <Loading label="Смотрим, что есть в подключённых источниках" /> : null}
        {q.isError ? <Notice tone="danger" text={friendlyError(q.error)} /> : null}
        {d?.poolErrors.length ? <Notice tone="warn" text={`Не ответили: ${d.poolErrors.map((e) => e.source).join(', ')}. Показываем то, что удалось получить.`} /> : null}
        {d && !d.poolSize ? <Empty title="Пока тихо" text="Источники не вернули музыку. Проверьте интернет или подключите свои файлы, сервер или каталог." action="Открыть источники" onAction={() => router.push('/sources')} /> : null}

        {d?.recent.length ? <Section title="Продолжить" action={{ label: 'История', onPress: () => router.push('/history') }}><Shelf>{d.recent.slice(0, 10).map((t, i) => <Poster key={t.id} t={t} tracks={d.recent} i={i} context="recent" />)}</Shelf></Section> : null}
        {d?.waveTracks.length ? <Section title="Дальше в волне" note="Нажмите, чтобы начать с этого трека">
          {d.waveTracks.slice(0, 3).map((t, i) => (
            <Press key={t.id} accessibilityRole="button" onPress={() => void player.playList(d.wave, i, 'wave')} style={{ flexDirection: 'row', gap: 12, alignItems: 'center', paddingVertical: 6 }}>
              <Cover uri={t.coverUrl} title={t.artist} size={52} radius={10} />
              <View style={{ flex: 1 }}>
                <T v="title" numberOfLines={1}>{t.title}</T>
                <T v="small" c="muted" numberOfLines={1}>{t.artist}</T>
                <T v="small" c="faint" numberOfLines={1}>{d.wave[i].reason}</T>
              </View>
            </Press>
          ))}
        </Section> : null}
        {d?.daily.length ? <Section title="Открытия дня" note="Этого вы ещё не слышали. Завтра будет новый набор."><TrackList tracks={d.daily.slice(0, 4)} context="daily" notes={d.dailyReasons} /></Section> : null}
        {d?.likeRecent ? <Section title={`Похоже на «${d.likeRecent.title}»`}><Shelf>{d.likeRecent.tracks.map((t, i) => <Poster key={t.id} t={t} tracks={d.likeRecent!.tracks} i={i} context="similar" />)}</Shelf></Section> : null}
        {d?.artists.length ? <Section title="Ваши исполнители">
          <Shelf>{d.artists.map((a) => (
            <Press key={a.name} accessibilityRole="link" onPress={() => router.push({ pathname: '/artist/[name]', params: { name: a.name } })} style={{ width: 92, alignItems: 'center' }}>
              <Cover uri={undefined} title={a.name} size={84} radius={42} />
              <T v="small" numberOfLines={2} style={{ marginTop: 6, textAlign: 'center' }}>{a.name}</T>
            </Press>))}</Shelf>
        </Section> : null}
        {d?.albums.length ? <Section title="Альбомы для вас"><Shelf>{d.albums.map((a) => (
          <Press key={`${a.source}${a.id}`} accessibilityRole="button" onPress={() => router.push({ pathname: '/album/[source]/[id]', params: { source: a.source, id: a.id, title: a.title } })} style={{ width: 180 }}>
            <Cover uri={a.cover} title={a.title} size={180} radius={20} /><T v="h3" numberOfLines={2} style={{ marginTop: 8 }}>{a.title}</T><T v="small" c="muted" numberOfLines={1}>{a.artist}</T>
          </Press>))}</Shelf></Section> : null}
        {d?.fresh.length ? <Section title="Новые релизы" action={{ label: 'Любимые исполнители', onPress: () => router.push('/releases') }}><TrackList tracks={d.fresh.slice(0, 4)} context="fresh" /></Section> : null}
        {d?.mixes.map((m) => <Section key={m.tag} title={`Подборка: ${m.tag}`}><Shelf>{m.tracks.map((t, i) => <Poster key={t.id} t={t} tracks={m.tracks} i={i} context={`mix:${m.tag}`} />)}</Shelf></Section>)}
        {d?.genrePopular.length ? <Section title="Популярное в ваших жанрах"><TrackList tracks={d.genrePopular.slice(0, 5)} context="popular" /></Section> : null}
        {d && d.interactions < 8 ? <T v="small" c="muted" style={{ marginTop: 30 }}>Рекомендации пока приблизительные. Они уточняются с каждым лайком, пропуском и дослушанным треком.</T> : null}
      </ScrollView>
    </View>
  );
}
