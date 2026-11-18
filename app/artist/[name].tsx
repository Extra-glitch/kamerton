import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';
import { normalizeText, primaryArtist } from '@/core/text';
import * as repo from '@/db/repo';
import { friendlyError } from '@/net/http';
import { artistTracks, federatedSearch } from '@/services/media';
import { bumpData, playTracks, toast, useUi } from '@/state/app';
import { Btn, Empty, Loading, Notice, Screen, T } from '@/ui/kit';
import { TrackList } from '@/ui/music';

export default function Artist() {
  const p = useLocalSearchParams<{ name: string; source?: string; id?: string }>();
  const name = primaryArtist(p.name);
  const v = useUi((u) => u.dataVersion);
  const q = useQuery({
    queryKey: ['artist', name, p.source, p.id, v],
    queryFn: async () => {
      const key = normalizeText(name);
      const direct = p.source && p.id ? await artistTracks(p.source, p.id).catch(() => []) : [];
      const found = await federatedSearch(name, { limit: 20 });
      const known = await repo.getViews(await repo.tracksByArtistName(name));
      const seen = new Set<string>();
      const all = [...direct, ...known, ...found.tracks.filter((t) => normalizeText(primaryArtist(t.artist)) === key)].filter((t) => !t.preferred?.isLive && !seen.has(t.id) && !!seen.add(t.id));
      return { tracks: all, errors: found.errors, followed: (await repo.followedArtists()).some((a) => a.key === key) };
    },
  });
  const tracks = q.data?.tracks ?? [];
  return (
    <Screen>
      <T v="poster" numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.45} style={{ marginBottom: 14 }}>{name}</T>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Btn label="Слушать" icon="play" disabled={!tracks.length} onPress={() => void playTracks(tracks.filter((t) => t.preferred?.availability === 'full'), 0, 'artist')} style={{ flex: 1 }} />
        <Btn label={q.data?.followed ? 'Вы подписаны' : 'Следить за релизами'} kind="line" onPress={async () => { if (q.data?.followed) await repo.unfollowArtist(name); else { await repo.followArtist(name); toast('Новые релизы появятся в подборке'); } bumpData(); }} />
      </View>
      {q.isLoading ? <Loading /> : null}
      {q.isError ? <Notice tone="danger" text={friendlyError(q.error)} /> : null}
      {q.data?.errors.map((e) => <Notice key={e.source} tone="warn" text={`${e.source}: ${e.message}`} />)}
      <View style={{ height: 16 }} />
      {tracks.length ? <TrackList tracks={tracks} context="artist" /> : q.data ? <Empty title="Треков не нашлось" text="Этого исполнителя нет в подключённых источниках." /> : null}
    </Screen>
  );
}
