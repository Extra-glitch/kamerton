import { useQuery } from '@tanstack/react-query';
import { FlashList } from '@shopify/flash-list';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { plural } from '@/core/text';
import type { Playlist } from '@/core/types';
import * as repo from '@/db/repo';
import { pickAudioFiles, scanDevice } from '@/platform/localMusic';
import { bumpData, toast, useUi } from '@/state/app';
import { Btn, Chip, Cover, Empty, Field, IconBtn, Row, Shelf, s as ks, T, useBottomPad } from '@/ui/kit';
import { Ambient } from '@/ui/ambient';
import { playOrOpen, TrackRow } from '@/ui/music';
import { SPACE, useColors } from '@/ui/theme';
import { sourceName } from '@/sources/registry';

type Tab = 'lists' | 'tracks' | 'liked' | 'albums' | 'artists' | 'downloads' | 'local';
const TABS: [Tab, string][] = [['lists', 'Плейлисты'], ['liked', 'Любимое'], ['local', 'На телефоне'], ['tracks', 'Все треки'], ['albums', 'Альбомы'], ['artists', 'Исполнители'], ['downloads', 'Сохранённое']];
const SORTS: [repo.LibrarySort, string][] = [['added', 'Недавно добавленные'], ['title', 'Название'], ['artist', 'Исполнитель'], ['album', 'Альбом'], ['date', 'Дата']];

export default function Library() {
  const bottomPad = useBottomPad();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const version = useUi((u) => u.dataVersion);
  const [tab, setTab] = useState<Tab>('lists');
  const [sort, setSort] = useState<repo.LibrarySort>('added');
  const [search, setSearch] = useState('');
  const [newName, setNewName] = useState<string | null>(null);
  const [newFolder, setNewFolder] = useState<string | null>(null);
  const [scan, setScan] = useState<string | null>(null);

  const trackTab = tab === 'tracks' || tab === 'liked' || tab === 'downloads' || tab === 'local';
  const tracks = useQuery({
    queryKey: ['lib', tab, sort, search, version], enabled: trackTab,
    queryFn: async () => {
      const ids = tab === 'liked' ? await repo.likedTrackIds() : tab === 'downloads' ? await repo.downloadedTrackIds() : tab === 'local' ? await repo.localTrackIds() : await repo.libraryTrackIds({ sort, search });
      return repo.getViews(ids);
    },
  });
  const lists = useQuery({ queryKey: ['playlists', version], queryFn: async () => ({ lists: await repo.listPlaylists(), folders: await repo.listFolders() }), enabled: tab === 'lists' });
  const albums = useQuery({ queryKey: ['albums', version], queryFn: repo.listSavedAlbums, enabled: tab === 'albums' });
  const artists = useQuery({ queryKey: ['artists', version], queryFn: async () => ({ lib: await repo.libraryArtists(), followed: await repo.followedArtists() }), enabled: tab === 'artists' });

  const shown = (tracks.data ?? []).filter((t) => !search || `${t.title} ${t.artist} ${t.album ?? ''}`.toLowerCase().includes(search.toLowerCase()));
  const createList = async () => { if (!newName?.trim()) return; const id = await repo.createPlaylist({ name: newName.trim() }); setNewName(null); bumpData(); router.push({ pathname: '/playlist/[id]', params: { id } }); };
  const runScan = async () => {
    setScan('Ищем музыку…');
    try { const n = await scanDevice((p) => setScan(`Обработано ${p.done} из ${p.total}`)); bumpData(); toast(`Найдено файлов: ${n}`); }
    catch (e) { toast((e as Error).message); } finally { setScan(null); }
  };

  const header = (
    <View style={{ paddingTop: insets.top + 14 }}>
      <T v="h1" style={{ marginBottom: 12 }} accessibilityRole="header">Коллекция</T>
      <Shelf>{TABS.map(([id, l]) => <Chip key={id} testID={`lib-${id}`} label={l} on={tab === id} onPress={() => setTab(id)} />)}</Shelf>
      <View style={{ height: 14 }} />
      {trackTab ? <>
        <Field placeholder="Поиск по коллекции" value={search} onChangeText={setSearch} />
        {tab === 'tracks' ? <><Shelf>{SORTS.map(([id, l]) => <Chip key={id} label={l} on={sort === id} onPress={() => setSort(id)} />)}</Shelf><View style={{ height: 8 }} /></> : null}
        {tab === 'local' ? <View style={{ flexDirection: 'row', gap: 10, marginBottom: 8 }}>
          <Btn label={scan ?? 'Найти файлы'} busy={!!scan} onPress={() => void runScan()} style={{ flex: 1 }} />
          <Btn label="Добавить файлы" kind="line" style={{ flex: 1 }} onPress={async () => { try { const n = await pickAudioFiles(); if (n) { bumpData(); toast(`Добавлено файлов: ${n}`); } } catch (e) { toast((e as Error).message); } }} />
        </View> : null}
      </> : null}
    </View>
  );

  if (trackTab) {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg }}>
        <Ambient strength={0.75} />
        <FlashList data={shown} keyExtractor={(t) => t.id} ListHeaderComponent={header} contentContainerStyle={{ paddingHorizontal: SPACE.page, paddingBottom: bottomPad }} keyboardShouldPersistTaps="handled"
          renderItem={({ item, index }) => <TrackRow t={item} onPress={() => playOrOpen(shown, index, `library:${tab}`)} />}
          ListEmptyComponent={tracks.isLoading ? null : <Empty title={tab === 'liked' ? 'Пока без любимого' : tab === 'local' ? 'Файлы не добавлены' : tab === 'downloads' ? 'Ничего не сохранено' : 'Коллекция пуста'} text={tab === 'local' ? 'Найдите музыку на телефоне или выберите файлы вручную.' : tab === 'downloads' ? 'Сохранять можно треки с вашего сервера и записи архива, где это разрешено.' : 'Лайкайте треки или импортируйте плейлисты из других сервисов.'} action={tab === 'local' ? undefined : 'Импорт музыки'} onAction={() => router.push('/import')} />} />
      </View>
    );
  }

  const free = lists.data?.lists.filter((p) => !p.folderId) ?? [];
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
        <Ambient strength={0.75} />
      <FlashList data={[0]} keyExtractor={() => 'x'} ListHeaderComponent={header} contentContainerStyle={{ paddingHorizontal: SPACE.page, paddingBottom: bottomPad }} keyboardShouldPersistTaps="handled" renderItem={() => (
        <View>
          {tab === 'lists' ? <>
            <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
              <Btn testID="new-playlist" label="Новый плейлист" kind="line" icon="plus" onPress={() => setNewName('')} />
              <Btn label="Папка" kind="line" onPress={() => setNewFolder('')} />
              <Btn testID="open-import" label="Импорт" onPress={() => router.push('/import')} />
            </View>
            {newName !== null ? <><Field autoFocus label="Название плейлиста" value={newName} onChangeText={setNewName} onSubmitEditing={createList} /><Btn label="Создать" onPress={() => void createList()} disabled={!newName.trim()} /></> : null}
            {newFolder !== null ? <><Field autoFocus label="Название папки" value={newFolder} onChangeText={setNewFolder} /><Btn label="Создать папку" disabled={!newFolder.trim()} onPress={async () => { await repo.createFolder(newFolder.trim()); setNewFolder(null); bumpData(); }} /></> : null}
            <Row title="Умные плейлисты" sub="Собираются сами по настроению, жанру, эпохе и темпу" onPress={() => router.push('/smart')} icon="similar" />
            <Row title="История прослушивания" onPress={() => router.push('/history')} icon="timer" />
            <Row title="Умная очистка" sub="Дубликаты, пропавшие и цензурированные версии" onPress={() => router.push('/cleanup')} icon="check" />
            {lists.data?.folders.map((f) => {
              const inside = lists.data!.lists.filter((p) => p.folderId === f.id);
              return <View key={f.id} style={{ marginTop: 20 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}><T v="h3" style={{ flex: 1 }}>{f.name}</T><IconBtn name="trash" label={`Удалить папку ${f.name}`} size={19} onPress={() => Alert.alert('Удалить папку?', 'Плейлисты останутся в коллекции.', [{ text: 'Отмена' }, { text: 'Удалить', style: 'destructive', onPress: () => { void repo.deleteFolder(f.id).then(bumpData); } }])} /></View>
                {inside.map((p) => <PlaylistLine key={p.id} p={p} />)}
                {!inside.length ? <T v="small" c="muted">Папка пуста. Переместить плейлист можно на его странице.</T> : null}
              </View>;
            })}
            <View style={{ height: 14 }} />
            {free.map((p) => <PlaylistLine key={p.id} p={p} />)}
            {lists.data && !lists.data.lists.length ? <Empty title="Плейлистов пока нет" text="Создайте свой или перенесите из другого сервиса: текстом, файлом или ссылкой." /> : null}
          </> : null}
          {tab === 'albums' ? (albums.data?.length ? albums.data.map((a) => (
            <Pressable key={a.id} accessibilityRole="button" onPress={() => router.push({ pathname: '/album/[source]/[id]', params: { source: a.source, id: a.sourceAlbumId, title: a.title } })} style={{ flexDirection: 'row', gap: 12, alignItems: 'center', paddingVertical: 7 }}>
              <Cover uri={a.coverUrl} title={a.title} size={64} /><View style={{ flex: 1 }}><T v="h3" numberOfLines={1}>{a.title}</T><T v="small" c="muted">{a.artist}, {sourceName(a.source)}</T></View>
            </Pressable>)) : <Empty title="Альбомов нет" text="Откройте альбом и нажмите «Сохранить»." />) : null}
          {tab === 'artists' ? <View>
            {artists.data?.followed.map((a) => <Row key={a.key} title={a.name} sub="Вы подписаны" onPress={() => router.push({ pathname: '/artist/[name]', params: { name: a.name } })} />)}
            {artists.data?.lib.map((a) => <Row key={a.name} title={a.name} sub={`${a.count} ${plural(a.count, 'трек', 'трека', 'треков')}`} onPress={() => router.push({ pathname: '/artist/[name]', params: { name: a.name } })} />)}
            {artists.data && !artists.data.lib.length && !artists.data.followed.length ? <Empty title="Исполнителей нет" text="Они появятся, когда в коллекции будут треки." /> : null}
          </View> : null}
        </View>
      )} />
    </View>
  );
}

function PlaylistLine({ p }: { p: Playlist }) {
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/playlist/[id]', params: { id: p.id } })} style={{ flexDirection: 'row', gap: 12, alignItems: 'center', paddingVertical: 7 }}>
      <Cover uri={p.coverUri} title={p.name} size={60} />
      <View style={{ flex: 1 }}><T v="h3" numberOfLines={1}>{p.name}</T><T v="small" c="muted">{p.itemCount ?? 0} {plural(p.itemCount ?? 0, 'трек', 'трека', 'треков')}{p.imported ? `, импорт: ${p.importedFrom ?? 'файл'}` : ''}</T></View>
    </Pressable>
  );
}
