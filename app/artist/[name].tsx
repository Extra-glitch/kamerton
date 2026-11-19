import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { normalizeText, primaryArtist } from '@/core/text';
import * as repo from '@/db/repo';
import { friendlyError } from '@/net/http';
import { adapter, LISTEN_ELSEWHERE, playMode } from '@/sources/registry';
import { artistPage } from '@/services/media';
import { bumpData, toast, useUi } from '@/state/app';
import { Ambient } from '@/ui/ambient';
import { Btn, Chip, Cover, Empty, Loading, Notice, Press, RoundBtn, Section, Shelf, s as ks, T, useBottomPad } from '@/ui/kit';
import { playOrOpen, TrackList } from '@/ui/music';
import { SPACE, useColors } from '@/ui/theme';

/** Широкий шрифт заголовка: длинные имена уменьшаем заранее, чтобы слово не разрывалось. */
const nameSize = (name: string) => {
  const longest = Math.max(...name.split(/\s+/).map((w) => w.length));
  const size = longest > 9 ? Math.max(22, Math.floor(40 * 9 / longest)) : 40;
  return { fontSize: size, lineHeight: Math.round(size * 1.15) };
};

export default function Artist() {
  const bottomPad = useBottomPad();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const p = useLocalSearchParams<{ name: string; deezer?: string }>();
  const name = primaryArtist(p.name);
  const v = useUi((u) => u.dataVersion);
  const [more, setMore] = useState(false);
  const q = useQuery({
    queryKey: ['artist', name, p.deezer],
    queryFn: async () => {
      const page = await artistPage(name, p.deezer);
      const known = (await repo.getViews(await repo.tracksByArtistName(name))).filter((t) => t.preferred && playMode(t.preferred) === 'player');
      const seen = new Set(page.free.map((t) => t.id));
      return { ...page, free: [...known.filter((t) => !seen.has(t.id)), ...page.free] };
    },
  });
  const followed = useQuery({ queryKey: ['followed', name, v], queryFn: async () => (await repo.followedArtists()).some((a) => a.key === normalizeText(name)) });
  const d = q.data;
  const title = d?.ref?.name ?? name;
  const image = d?.ref?.imageUrl;
  const playAll = () => {
    const list = d?.free.length ? d.free : d?.videos.length ? d.videos : d?.top ?? [];
    if (list.length) playOrOpen(list, 0, 'artist');
  };
  return (
    <View style={{ flex: 1 }}>
      <Ambient strength={0.7} />
      <ScrollView contentContainerStyle={{ paddingBottom: bottomPad }}>
        <View style={{ height: 300 + insets.top, justifyContent: 'flex-end', paddingHorizontal: SPACE.page, paddingBottom: 16 }}>
          {image ? <Image source={image} blurRadius={2} contentFit="cover" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} accessibilityIgnoresInvertColors /> : null}
          <LinearGradient colors={['rgba(0,0,0,0.05)', 'rgba(0,0,0,0.15)', c.bg]} locations={[0, 0.45, 1]} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
          <View style={{ position: 'absolute', top: insets.top + 6, left: SPACE.page - 4 }}><RoundBtn name="back" label="Назад" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} /></View>
          {!image ? <Cover title={title} size={120} radius={60} style={{ marginBottom: 14 }} /> : null}
          <T v="poster" numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.6} style={{ color: image ? '#ffffff' : c.text, ...nameSize(title) }}>{title}</T>
          {d?.ref?.followers ? <T v="small" style={{ color: image ? 'rgba(255,255,255,0.85)' : c.muted }}>{d.ref.followers.toLocaleString('ru-RU')} слушателей в Deezer</T> : null}
        </View>
        <View style={{ paddingHorizontal: SPACE.page }}>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Btn label={d?.free.length || d?.videos.length ? 'Слушать' : 'Фрагменты'} icon="play" disabled={!d || (!d.free.length && !d.top.length && !d.videos.length)} onPress={playAll} style={{ flex: 1 }} />
            <Btn label={followed.data ? 'Вы следите' : 'Следить'} icon={followed.data ? 'check' : 'plus'} kind="line" style={{ flex: 1 }} onPress={async () => { if (followed.data) await repo.unfollowArtist(name); else { await repo.followArtist(name); toast('Новые релизы появятся в подборке'); } bumpData(); }} />
          </View>

          {q.isLoading ? <Loading label="Собираем популярное, альбомы и то, что играет целиком" /> : null}
          {q.isError ? <Notice tone="danger" text={friendlyError(q.error)} /> : null}
          {d?.errors.map((e) => <Notice key={e} tone="warn" text={e} />)}

          {d?.videos.length ? <Section title="Слушать на YouTube" note="Целиком во встроенном плеере YouTube"><TrackList tracks={d.videos} context="artist" /></Section> : null}
          {d?.free.length ? <Section title="Целиком в Камертоне" note="С телефона, вашего сервера и подключённых площадок"><TrackList tracks={d.free} context="artist" /></Section> : null}
          {d?.top.length ? <Section title="Популярное" note="Фрагменты по 30 секунд из каталога Deezer">
            <TrackList tracks={more ? d.top : d.top.slice(0, 10)} context="artist" numbered />
            {!more && d.top.length > 10 ? <Btn label={`Ещё ${d.top.length - 10}`} kind="line" onPress={() => setMore(true)} style={{ marginTop: 8 }} /> : null}
          </Section> : null}
          {d?.albums.length ? <Section title="Альбомы и синглы"><Shelf>{d.albums.map((a) => (
            <Press key={a.id} accessibilityRole="link" onPress={() => router.push({ pathname: '/album/[source]/[id]', params: { source: a.source, id: a.id, title: a.title } })} style={{ width: 150 }}>
              <Cover uri={a.coverUrl} title={a.title} size={150} radius={18} />
              <T v="title" numberOfLines={1} style={{ marginTop: 7 }}>{a.title}</T>
              <T v="small" c="muted" numberOfLines={1}>{[a.year, a.kind === 'single' ? 'сингл' : a.kind === 'ep' ? 'EP' : a.kind === 'album' ? 'альбом' : null].filter(Boolean).join(', ')}</T>
            </Press>))}</Shelf></Section> : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 28, alignItems: 'center' }}>
            <T v="small" c="faint">Открыть {title} в:</T>
            {LISTEN_ELSEWHERE.map((id) => adapter(id)).filter((a) => a?.externalUrl).map((a) => <Chip key={a!.id} label={a!.name} onPress={() => { const u = a!.externalUrl!({ title: '', artist: title }); if (u) void Linking.openURL(u); }} />)}
          </View>
          {d && !d.free.length && !d.top.length && !d.videos.length ? <Empty title="Ничего не нашлось" text="Каталог и подключённые источники не знают этого исполнителя. Проверьте написание имени." /> : null}
        </View>
      </ScrollView>
    </View>
  );
}
