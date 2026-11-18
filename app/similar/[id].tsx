import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';
import * as repo from '@/db/repo';
import { friendlyError } from '@/net/http';
import { similarTracks } from '@/services/reco';
import { player, useUi } from '@/state/app';
import { Btn, Empty, Loading, Notice, Screen, T } from '@/ui/kit';
import { TrackList } from '@/ui/music';

export default function Similar() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const v = useUi((u) => u.dataVersion);
  const seed = useQuery({ queryKey: ['track', id, v], queryFn: () => repo.getView(id) });
  const q = useQuery({ queryKey: ['similar', id, v], queryFn: () => similarTracks(id) });
  const tracks = q.data?.map((r) => r.track) ?? [];
  const rare = [...(q.data ?? [])].filter((r) => r.track.popularity != null).sort((a, b) => a.track.popularity! - b.track.popularity!).slice(0, 5);
  return (
    <Screen title="Похожие">
      {seed.data ? <T c="muted" style={{ marginTop: -12, marginBottom: 12 }}>на «{seed.data.title}», {seed.data.artist}</T> : null}
      <Btn testID="start-radio" label="Создать радио по этой песне" icon="radio" onPress={() => void player.playList([{ trackId: id }], 0, `radio:${id}`)} />
      <T v="small" c="muted" style={{ marginTop: 6 }}>Бесконечный поток: с каждым кругом исполнители становятся разнообразнее.</T>
      {q.isLoading ? <Loading label="Сравниваем жанры, настроение и темп" /> : null}
      {q.isError ? <Notice tone="danger" text={friendlyError(q.error)} /> : null}
      {rare.length >= 3 ? <View style={{ marginTop: 24 }}><T v="h2" style={{ marginBottom: 8 }}>Малоизвестные находки</T><TrackList tracks={rare.map((r) => r.track)} context="similar" notes={new Map(rare.map((r) => [r.track.id, r.reason]))} /></View> : null}
      {tracks.length ? <View style={{ marginTop: 24 }}><T v="h2" style={{ marginBottom: 8 }}>Все совпадения</T><TrackList tracks={tracks} context="similar" notes={new Map(q.data!.map((r) => [r.track.id, r.reason]))} /></View> : null}
      {q.data && !tracks.length ? <Empty title="Похожих пока нет" text="У трека мало описания. Подключите больше источников или послушайте что-то ещё." /> : null}
    </Screen>
  );
}
