import { useQuery } from '@tanstack/react-query';
import { View } from 'react-native';
import { plural } from '@/core/text';
import * as repo from '@/db/repo';
import { analyzeLibrary } from '@/reco/extras';
import { bumpData, toast, useUi } from '@/state/app';
import { Btn, Empty, Loading, Screen, Section, T } from '@/ui/kit';
import { TrackList } from '@/ui/music';

export default function Cleanup() {
  const v = useUi((u) => u.dataVersion);
  const q = useQuery({
    queryKey: ['cleanup', v],
    queryFn: async () => {
      const lists = await repo.listPlaylists();
      const items = (await Promise.all(lists.map((p) => repo.getPlaylistItems(p.id)))).flat();
      const tracks = await repo.getViews(await repo.libraryTrackIds());
      return { report: analyzeLibrary(items, new Map(tracks.map((t) => [t.id, t]))), names: new Map(lists.map((p) => [p.id, p.name])) };
    },
  });
  const r = q.data?.report;
  const empty = r && !r.duplicatesInPlaylist.length && !r.sameSongManySources.length && !r.missing.length && !r.unavailable.length && !r.cleanVersions.length;
  return (
    <Screen title="Очистка">
      <T c="muted" style={{ marginTop: -8 }}>Ничего не удаляется без вашего подтверждения.</T>
      {q.isLoading ? <Loading /> : null}
      {empty ? <Empty title="Всё в порядке" text="Дубликатов и пропавших песен нет." /> : null}
      {r?.duplicatesInPlaylist.length ? <Section title="Дубликаты в плейлистах">
        {r.duplicatesInPlaylist.map((d) => <View key={d.items[0].id} style={{ marginBottom: 12 }}>
          <T v="title">{d.items[0].rawArtist}: {d.items[0].rawTitle}</T><T v="small" c="muted">«{q.data!.names.get(d.playlistId)}», повторов: {d.items.length}</T>
          <Btn label="Оставить одну" kind="line" style={{ alignSelf: 'flex-start', marginTop: 6 }} onPress={async () => { for (const it of d.items.slice(1)) await repo.removePlaylistItem(it.id); bumpData(); toast('Дубликаты убраны'); }} />
        </View>)}
      </Section> : null}
      {r?.cleanVersions.length ? <Section title="Цензурированные версии" note="Откройте меню трека, чтобы выбрать другой источник."><TrackList tracks={r.cleanVersions} context="cleanup" /></Section> : null}
      {r?.unavailable.length ? <Section title="Больше недоступны"><TrackList tracks={r.unavailable.map((u) => u.track)} context="cleanup" /></Section> : null}
      {r?.missing.length ? <Section title="Не найдены" note="Они сохранены в плейлистах на своих местах.">{r.missing.slice(0, 50).map((i) => <T key={i.id} v="small" c="muted" style={{ marginBottom: 4 }}>{i.rawArtist}: {i.rawTitle}</T>)}</Section> : null}
      {r?.sameSongManySources.length ? <Section title="Одна песня в нескольких сервисах" note="Это не ошибка: источник можно выбрать в меню трека."><TrackList tracks={r.sameSongManySources.slice(0, 30)} context="cleanup" /></Section> : null}
      {r?.unknownVersion ? <T v="small" c="muted" style={{ marginTop: 26 }}>У {r.unknownVersion} {plural(r.unknownVersion, 'трека', 'треков', 'треков')} источник не сообщает, есть ли цензура.</T> : null}
    </Screen>
  );
}
