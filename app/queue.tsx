import { useState } from 'react';
import { Pressable, View } from 'react-native';
import * as repo from '@/db/repo';
import { djSequence, type DjMode } from '@/reco/extras';
import { player, toast, usePlayer } from '@/state/app';
import { Chip, Cover, Empty, IconBtn, s as ks, Screen, T } from '@/ui/kit';
import { useQuery } from '@tanstack/react-query';
import { sourceName } from '@/sources/registry';
import { useColors } from '@/ui/theme';

const DJ: { id: DjMode; label: string; done: string }[] = [
  { id: 'smooth', label: 'Плавно', done: 'Умный DJ выстроил плавные переходы' },
  { id: 'rise', label: 'С разгоном', done: 'Умный DJ выстроил нарастание' },
  { id: 'contrast', label: 'На контрасте', done: 'Умный DJ чередует разное' },
];

export default function Queue() {
  const c = useColors();
  const queue = usePlayer((p) => p.queue);
  const index = usePlayer((p) => p.index);
  const ids = queue.map((q) => q.trackId);
  const views = useQuery({ queryKey: ['queue-views', ids.join()], queryFn: async () => new Map((await repo.getViews(ids)).map((v) => [v.id, v])) });
  const [dj, setDj] = useState<DjMode | null>(null);
  const upcoming = queue.slice(index + 1);
  const runDj = async (mode: DjMode) => {
    const list = (await repo.getViews(upcoming.map((u) => u.trackId))).filter((v) => v.preferred);
    if (list.length < 2) { toast('Для DJ нужно хотя бы два трека впереди'); return; }
    const steps = djSequence(list, mode);
    await player.replaceUpcoming(steps.map((s) => ({ trackId: s.track.id, reason: s.note })));
    setDj(mode); toast(DJ.find((d) => d.id === mode)!.done);
  };
  return (
    <Screen title="Очередь" right={upcoming.length ? <Pressable accessibilityRole="button" onPress={() => void player.clearUpcoming()} style={{ paddingHorizontal: 12 }}><T v="strong" c="accent">Очистить</T></Pressable> : null}>
      <T v="h3">Умный DJ</T>
      <T v="small" c="muted" style={{ marginBottom: 8 }}>Переставляет следующие треки по жанрам, темпу и эпохе и подписывает каждый переход.</T>
      <View style={ks.wrap}>{DJ.map((d) => <Chip key={d.id} testID={`dj-${d.id}`} label={d.label} on={dj === d.id} onPress={() => void runDj(d.id)} />)}</View>
      <View style={{ height: 20 }} />
      {!queue.length ? <Empty title="Очередь пуста" text="Включите волну или любой трек." /> : null}
      {queue.map((q, i) => {
        const v = views.data?.get(q.trackId);
        if (!v || i < index) return null;
        const cur = i === index;
        const src = v.sources.find((s) => s.id === q.sourceTrackId) ?? v.preferred;
        return (
          <View key={q.qid} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 }}>
            <Pressable accessibilityRole="button" accessibilityLabel={`Играть ${v.title}`} onPress={() => void player.jumpTo(q.qid)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
              <Cover uri={v.coverUrl} title={v.artist} size={46} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <T v="title" c={cur ? 'accent' : 'text'} numberOfLines={1}>{v.title}</T>
                <T v="small" c="muted" numberOfLines={1}>{v.artist}{src ? `, ${sourceName(src.source)}` : ''}</T>
                {q.reason ? <T v="small" c="faint" numberOfLines={1}>{q.reason}</T> : null}
              </View>
            </Pressable>
            {!cur ? <>
              <IconBtn name="up" label="Выше" size={19} color={c.muted} onPress={() => void player.moveInQueue(q.qid, -1)} disabled={i === index + 1} />
              <IconBtn name="down" label="Ниже" size={19} color={c.muted} onPress={() => void player.moveInQueue(q.qid, 1)} disabled={i === queue.length - 1} />
              <IconBtn name="close" label="Убрать" size={19} color={c.muted} onPress={() => void player.removeFromQueue(q.qid)} />
            </> : null}
          </View>
        );
      })}
    </Screen>
  );
}
