import { useQuery } from '@tanstack/react-query';
import * as repo from '@/db/repo';
import { friendlyError } from '@/net/http';
import { dailyDiscoveries } from '@/services/reco';
import { player, useUi } from '@/state/app';
import { Btn, Empty, Loading, Notice, Screen, T } from '@/ui/kit';
import { TrackList } from '@/ui/music';

export default function Discoveries() {
  const v = useUi((u) => u.dataVersion);
  const q = useQuery({ queryKey: ['daily', v], queryFn: async () => { const items = await dailyDiscoveries(); return { items, tracks: await repo.getViews(items.map((i) => i.trackId)) }; } });
  return (
    <Screen title="Открытия дня">
      <T c="muted" style={{ marginTop: -8, marginBottom: 12 }}>Только то, что вы ещё ни разу не слушали. Завтра подборка обновится.</T>
      {q.isLoading ? <Loading /> : null}
      {q.isError ? <Notice tone="danger" text={friendlyError(q.error)} /> : null}
      {q.data?.items.length ? <>
        <Btn testID="daily-play" label="Слушать все" icon="play" onPress={() => void player.playList(q.data!.items, 0, 'daily')} style={{ marginBottom: 12 }} />
        <TrackList tracks={q.data.tracks} context="daily" notes={new Map(q.data.items.map((i) => [i.trackId, i.reason]))} />
      </> : q.data ? <Empty title="Открытий пока нет" text="Источники не вернули новую музыку. Проверьте интернет или подключите ещё один каталог." /> : null}
    </Screen>
  );
}
