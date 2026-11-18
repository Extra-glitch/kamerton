import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { View } from 'react-native';
import * as repo from '@/db/repo';
import { friendlyError } from '@/net/http';
import { newReleases } from '@/services/reco';
import { Btn, Empty, Loading, Notice, Screen, T } from '@/ui/kit';
import { TrackList } from '@/ui/music';

export default function Releases() {
  const q = useQuery({ queryKey: ['releases'], queryFn: async () => { const list = await newReleases(); return { list, tracks: await repo.getViews(list.flatMap((r) => (r.trackId ? [r.trackId] : []))) }; } });
  const announced = q.data?.list.filter((r) => r.kind === 'announced') ?? [];
  return (
    <Screen title="Новые релизы">
      <T c="muted" style={{ marginTop: -8, marginBottom: 12 }}>Исполнители, на которых вы подписаны или которых часто слушаете, за последние полгода.</T>
      {q.isLoading ? <Loading label="Проверяем источники и MusicBrainz. Это может занять минуту." /> : null}
      {q.isError ? <Notice tone="danger" text={friendlyError(q.error)} /> : null}
      {q.data?.tracks.length ? <TrackList tracks={q.data.tracks} context="releases" /> : null}
      {announced.length ? <View style={{ marginTop: 26 }}>
        <T v="h2">Вышло, но здесь не играет</T>
        <T v="small" c="muted" style={{ marginBottom: 8 }}>Сведения из MusicBrainz. В подключённых источниках этих релизов пока нет.</T>
        {announced.map((r) => <View key={`${r.artist}${r.title}`} style={{ marginBottom: 8 }}><T v="title">{r.title}</T><T v="small" c="muted">{r.artist}{r.date ? `, ${r.date}` : ''}</T></View>)}
      </View> : null}
      {q.data && !q.data.list.length ? <Empty title="Новинок не найдено" text="Подпишитесь на исполнителей на их страницах или послушайте больше музыки." /> : null}
      {q.data ? <Btn label="Проверить снова" kind="line" style={{ marginTop: 20, alignSelf: 'flex-start' }} onPress={async () => { await newReleases(true); await q.refetch(); }} /> : null}
      <Btn label="Открытия дня" kind="quiet" style={{ alignSelf: 'flex-start' }} onPress={() => router.push('/discoveries')} />
    </Screen>
  );
}
