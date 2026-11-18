import { useQuery } from '@tanstack/react-query';
import * as Sharing from 'expo-sharing';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Platform, Pressable, Share, View } from 'react-native';
import { plural } from '@/core/text';
import * as repo from '@/db/repo';
import type { ExportFormat } from '@/import/formats';
import { pickImage, writeExportFile } from '@/platform/localMusic';
import { djSequence } from '@/reco/extras';
import { playlistExportText } from '@/services/media';
import { bumpData, player, playTracks, toast, useUi } from '@/state/app';
import { Btn, Chip, Cover, Field, IconBtn, Notice, Screen, s as ks, T } from '@/ui/kit';
import { TrackRow } from '@/ui/music';
import { useColors } from '@/ui/theme';

const STATUS: Record<string, string> = { doubtful: 'Сомнительное совпадение', clean_only: 'Найдена только цензурированная версия', missing: 'Не найдено' };

export default function PlaylistScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useColors();
  const v = useUi((u) => u.dataVersion);
  const [edit, setEdit] = useState(false);
  const [name, setName] = useState('');
  const q = useQuery({
    queryKey: ['playlist', id, v],
    queryFn: async () => {
      const p = await repo.getPlaylist(id);
      const items = await repo.getPlaylistItems(id);
      const views = new Map((await repo.getViews(items.flatMap((i) => (i.trackId ? [i.trackId] : [])))).map((t) => [t.id, t]));
      return { p, items, views, folders: await repo.listFolders() };
    },
  });
  const d = q.data;
  if (!d?.p) return <Screen title={q.isLoading ? '' : 'Плейлист не найден'}>{null}</Screen>;
  const p = d.p;
  const tracks = d.items.flatMap((i) => { const t = i.trackId ? d.views.get(i.trackId) : undefined; return t ? [t] : []; });
  const playable = tracks.filter((t) => t.preferred?.availability === 'full');
  const missing = d.items.length - tracks.length;
  const doExport = async (fmt: ExportFormat) => {
    const f = await playlistExportText(id, fmt);
    if (Platform.OS === 'web') { void Share.share({ message: f.text }); return; }
    await Sharing.shareAsync(writeExportFile(f.name, f.text), { dialogTitle: p.name });
  };
  return (
    <Screen right={<IconBtn name="more" label="Изменить плейлист" active={edit} onPress={() => { setEdit(!edit); setName(p.name); }} />}>
      <View style={{ flexDirection: 'row', gap: 14, alignItems: 'flex-end' }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Выбрать обложку" disabled={!edit} onPress={async () => { const u = await pickImage(); if (u) { await repo.updatePlaylist(id, { coverUri: u }); bumpData(); } }}><Cover uri={p.coverUri ?? tracks[0]?.coverUrl} title={p.name} size={118} /></Pressable>
        <View style={{ flex: 1 }}><T v="h2" numberOfLines={3}>{p.name}</T><T v="small" c="muted">{d.items.length} {plural(d.items.length, 'трек', 'трека', 'треков')}{missing ? `, не найдено: ${missing}` : ''}</T>{p.imported ? <T v="small" c="faint">Импорт: {p.importedFrom}</T> : null}</View>
      </View>
      <View style={{ flexDirection: 'row', gap: 10, marginVertical: 14 }}>
        <Btn testID="playlist-play" label="Слушать" icon="play" disabled={!playable.length} onPress={() => void playTracks(playable, 0, `playlist:${id}`)} style={{ flex: 1 }} />
        <Btn label="Умный DJ" kind="line" disabled={playable.length < 2} onPress={() => { const s = djSequence(playable); void player.playList(s.map((x) => ({ trackId: x.track.id, reason: x.note })), 0, 'dj'); }} />
      </View>
      {edit ? <View style={{ marginBottom: 12 }}>
        <Field label="Название" value={name} onChangeText={setName} onEndEditing={async () => { if (name.trim()) { await repo.updatePlaylist(id, { name: name.trim() }); bumpData(); } }} />
        <T v="strong" style={{ marginBottom: 6 }}>Экспорт</T>
        <View style={ks.wrap}>{(['m3u8', 'csv', 'json', 'xspf'] as ExportFormat[]).map((f) => <Chip key={f} label={f.toUpperCase()} onPress={() => void doExport(f).catch((e) => toast(e.message))} />)}</View>
        {d.folders.length ? <><T v="strong" style={{ marginVertical: 6 }}>Папка</T><View style={ks.wrap}><Chip label="Без папки" on={!p.folderId} onPress={async () => { await repo.updatePlaylist(id, { folderId: null }); bumpData(); }} />{d.folders.map((f) => <Chip key={f.id} label={f.name} on={p.folderId === f.id} onPress={async () => { await repo.updatePlaylist(id, { folderId: f.id }); bumpData(); }} />)}</View></> : null}
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
          <Btn label="Выше в списке" kind="line" onPress={async () => { await repo.movePlaylist(id, -1); bumpData(); }} />
          <Btn label="Удалить" kind="line" icon="trash" onPress={() => Alert.alert('Удалить плейлист?', 'Сами треки останутся в библиотеке.', [{ text: 'Отмена' }, { text: 'Удалить', style: 'destructive', onPress: () => { void repo.deletePlaylist(id).then(() => { bumpData(); router.back(); }); } }])} />
        </View>
      </View> : null}
      {missing ? <Notice tone="warn" text="Ненайденные песни сохранены на своих местах: их можно найти позже." /> : null}
      {d.items.map((i, n) => {
        const t = i.trackId ? d.views.get(i.trackId) : undefined;
        const controls = edit ? <>
          <IconBtn name="up" label="Выше" size={19} color={c.muted} disabled={n === 0} onPress={async () => { await repo.movePlaylistItem(id, i.id, -1); bumpData(); }} />
          <IconBtn name="down" label="Ниже" size={19} color={c.muted} disabled={n === d.items.length - 1} onPress={async () => { await repo.movePlaylistItem(id, i.id, 1); bumpData(); }} />
          <IconBtn name="close" label="Убрать" size={19} color={c.muted} onPress={async () => { await repo.removePlaylistItem(i.id); bumpData(); }} />
        </> : undefined;
        if (t) return <View key={i.id}><TrackRow t={t} right={controls} onPress={() => { const k = playable.indexOf(t); if (k >= 0) void playTracks(playable, k, `playlist:${id}`); }} />{i.status !== 'matched' ? <T v="small" c="warn" style={{ marginLeft: 66, marginTop: -4 }}>{STATUS[i.status]}{i.matchNote ? `: ${i.matchNote}` : ''}</T> : null}</View>;
        return <View key={i.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 7, opacity: 0.75 }}>
          <Cover title={i.rawArtist || i.rawTitle} size={54} />
          <View style={{ flex: 1 }}><T v="title" numberOfLines={1}>{i.rawTitle}</T><T v="small" c="muted" numberOfLines={1}>{i.rawArtist}</T><T v="small" c="warn">Не найдено, место в списке: {(i.originalPosition ?? n) + 1}</T></View>{controls}
        </View>;
      })}
    </Screen>
  );
}
