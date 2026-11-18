import { useQuery } from '@tanstack/react-query';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { Platform, Share, View } from 'react-native';
import * as repo from '@/db/repo';
import { pickTextFile, writeExportFile } from '@/platform/localMusic';
import { buildTasteCard, compareTaste, parseTasteCard, type TasteCard } from '@/reco/extras';
import { loadReco } from '@/services/reco';
import { bumpData, player, toast, useUi } from '@/state/app';
import { useSettings } from '@/state/settings';
import { Btn, Empty, Field, IconBtn, Notice, Screen, T } from '@/ui/kit';
import { TrackList } from '@/ui/music';

export default function SharedLikes() {
  const v = useUi((u) => u.dataVersion);
  const s = useSettings();
  const [paste, setPaste] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const friends = useQuery({ queryKey: ['friends', v], queryFn: () => repo.listFriends<TasteCard>() });
  const friend = friends.data?.find((f) => f.id === open);
  const cmp = useQuery({
    queryKey: ['compare', open, v], enabled: !!friend,
    queryFn: async () => { const { pool, profile } = await loadReco(); return compareTaste(friend!.card, await repo.getViews(await repo.likedTrackIds()), pool, profile); },
  });
  const share = async () => {
    const { profile } = await loadReco();
    const card = buildTasteCard(s.profileName || 'Друг', await repo.getViews(await repo.likedTrackIds()), profile);
    const text = JSON.stringify(card);
    if (Platform.OS === 'web') await Share.share({ message: text });
    else await Sharing.shareAsync(writeExportFile('taste-card.json', text), { dialogTitle: 'Карточка вкуса' });
  };
  const add = async (text: string) => {
    try { setError(null); const card = parseTasteCard(text); const id = await repo.saveFriend(card.name, card); setPaste(''); bumpData(); setOpen(id); toast(`Добавлено: ${card.name}`); }
    catch (e) { setError((e as Error).message); }
  };
  return (
    <Screen title="Общие лайки">
      <T c="muted" style={{ marginTop: -8 }}>Без аккаунтов и сервера. Вы обмениваетесь файлом с названиями любимых песен и основными жанрами.</T>
      <Field label="Ваше имя в карточке" value={s.profileName} onChangeText={(t) => s.set({ profileName: t })} placeholder="Например, Саша" />
      <Btn testID="share-card" label="Поделиться моей карточкой" icon="share" onPress={() => void share().catch((e) => toast(e.message))} />
      <View style={{ height: 10 }} />
      <Btn label="Открыть карточку друга" kind="line" onPress={async () => { const f = await pickTextFile(['application/json', 'text/*']); if (f) await add(f.text); }} />
      <View style={{ height: 14 }} />
      <Field placeholder="Или вставьте текст карточки" multiline value={paste} onChangeText={setPaste} style={{ minHeight: 60 }} />
      {paste.trim() ? <Btn label="Добавить" kind="line" onPress={() => void add(paste)} /> : null}
      {error ? <Notice tone="danger" text={error} /> : null}
      {friends.data?.map((f) => <View key={f.id} style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12 }}>
        <Btn label={f.name} kind="quiet" onPress={() => setOpen(open === f.id ? null : f.id)} style={{ flex: 1, justifyContent: 'flex-start' }} />
        <IconBtn name="trash" size={19} label={`Удалить ${f.name}`} onPress={async () => { await repo.removeFriend(f.id); if (open === f.id) setOpen(null); bumpData(); }} />
      </View>)}
      {friend && cmp.data ? <View style={{ marginTop: 18 }}>
        <T v="h1">{Math.round(cmp.data.match * 100)}%</T><T v="small" c="muted">совпадение вкусов с {friend.name}</T>
        {cmp.data.commonTags.length ? <T style={{ marginTop: 10 }}>Общее: {cmp.data.commonTags.slice(0, 8).join(', ')}</T> : null}
        {cmp.data.forBoth.length ? <View style={{ marginTop: 18 }}>
          <T v="h2">Понравится обоим</T>
          <Btn label="Включить общий поток" icon="play" style={{ marginVertical: 10 }} onPress={() => void player.playList(cmp.data!.forBoth.map((x) => ({ trackId: x.track.id, reason: `Подходит вам и ${friend.name}` })), 0, 'shared')} />
          <TrackList tracks={cmp.data.forBoth.map((x) => x.track).slice(0, 12)} context="shared" />
        </View> : null}
        {cmp.data.common.length ? <View style={{ marginTop: 18 }}><T v="h2" style={{ marginBottom: 6 }}>Вы оба любите</T><TrackList tracks={cmp.data.common} context="shared" /></View> : null}
        {!cmp.data.common.length && !cmp.data.forBoth.length ? <Empty title="Пересечений пока нет" text="Послушайте и лайкните больше музыки, затем сравните снова." /> : null}
      </View> : null}
    </Screen>
  );
}
