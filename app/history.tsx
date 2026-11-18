import { useQuery } from '@tanstack/react-query';
import { Alert, Pressable } from 'react-native';
import * as repo from '@/db/repo';
import { bumpData, playTracks, useUi } from '@/state/app';
import { Empty, Screen, T } from '@/ui/kit';
import { TrackRow } from '@/ui/music';

export default function History() {
  const v = useUi((u) => u.dataVersion + u.playVersion);
  const q = useQuery({ queryKey: ['history', v], queryFn: async () => { const rows = await repo.historyRows(); const m = new Map((await repo.getViews(rows.map((r) => r.trackId))).map((t) => [t.id, t])); return rows.flatMap((r) => { const t = m.get(r.trackId); return t ? [{ ...r, t }] : []; }); } });
  return (
    <Screen title="История" right={q.data?.length ? <Pressable accessibilityRole="button" style={{ paddingHorizontal: 12 }} onPress={() => Alert.alert('Очистить историю?', 'Рекомендации начнут учиться заново.', [{ text: 'Отмена' }, { text: 'Очистить', style: 'destructive', onPress: () => { void repo.clearHistory().then(bumpData); } }])}><T v="strong" c="accent">Очистить</T></Pressable> : null}>
      {q.data?.map((r) => <TrackRow key={`${r.trackId}${r.startedAt}`} t={r.t} note={`${new Date(r.startedAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}${r.skipped ? ', пропущено' : r.completed ? ', дослушано' : ''}`} onPress={() => void playTracks([r.t], 0, 'history')} />)}
      {q.data && !q.data.length ? <Empty title="История пуста" text="Здесь появятся настоящие прослушивания. Импортированные плейлисты сюда не попадают." /> : null}
    </Screen>
  );
}
