import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';
import * as repo from '@/db/repo';
import { friendlyError } from '@/net/http';
import { adapter, sourceName } from '@/sources/registry';
import { albumTracks, sourceCtx } from '@/services/media';
import { bumpData, playTracks, toast, useUi } from '@/state/app';
import { Btn, Cover, Empty, Loading, Notice, Screen, T } from '@/ui/kit';
import { TrackList } from '@/ui/music';
import { useWindowDimensions } from 'react-native';

export default function Album() {
  const p = useLocalSearchParams<{ source: string; id: string; title?: string; playlist?: string }>();
  const { width } = useWindowDimensions();
  const v = useUi((u) => u.dataVersion);
  const q = useQuery({
    queryKey: ['album', p.source, p.id],
    queryFn: async () => {
      if (p.playlist) {
        const list = await adapter(p.source)!.playlistTracks!(sourceCtx, p.id);
        return repo.getViews(await repo.upsertMany(list, { pool: true }));
      }
      return albumTracks(p.source, p.id);
    },
  });
  const saved = useQuery({ queryKey: ['album-saved', p.source, p.id, v], queryFn: async () => (await repo.listSavedAlbums()).some((a) => a.id === `${p.source}:${p.id}`) });
  const tracks = q.data ?? [];
  const first = tracks[0];
  const title = p.title || first?.album || 'Альбом';
  return (
    <Screen>
      <Cover uri={first?.coverUrl} title={title} size={Math.min(width - 40, 420)} />
      <T v="h1" style={{ marginTop: 14 }}>{title}</T>
      <T c="muted">{first?.artist}{first?.year ? `, ${first.year}` : ''}</T>
      <T v="small" c="faint">{sourceName(p.source)}{first?.preferred?.attribution ? `. ${first.preferred.attribution}` : ''}</T>
      <View style={{ flexDirection: 'row', gap: 10, marginVertical: 14 }}>
        <Btn label="Слушать" icon="play" disabled={!tracks.length} onPress={() => void playTracks(tracks, 0, 'album')} style={{ flex: 1 }} />
        {!p.playlist ? <Btn label={saved.data ? 'Сохранён' : 'Сохранить'} kind="line" onPress={async () => { if (saved.data) await repo.unsaveAlbum(`${p.source}:${p.id}`); else { await repo.saveAlbum({ title, artist: first?.artist ?? '', coverUrl: first?.coverUrl, source: p.source, sourceAlbumId: p.id }); toast('Альбом в коллекции'); } bumpData(); }} /> : null}
      </View>
      {q.isLoading ? <Loading /> : null}
      {q.isError ? <Notice tone="danger" text={friendlyError(q.error)} /> : null}
      {tracks.length ? <TrackList tracks={tracks} context="album" numbered /> : q.data ? <Empty title="Треков нет" text="Источник не вернул дорожки этого альбома." /> : null}
    </Screen>
  );
}
