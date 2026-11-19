import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Linking, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { effectiveExplicit } from '@/core/choose';
import { GENRES } from '@/core/genres';
import * as repo from '@/db/repo';
import { friendlyError } from '@/net/http';
import { adapter, LISTEN_ELSEWHERE, playMode, sourceName } from '@/sources/registry';
import { federatedSearch, isLink, radioResults, searchLink } from '@/services/media';
import { bumpData, playTracks, toast } from '@/state/app';
import { useSettings } from '@/state/settings';
import { Ambient } from '@/ui/ambient';
import { Glass } from '@/ui/glass';
import { Btn, Chip, Cover, Empty, Field, Loading, Notice, Press, Section, Shelf, s as ks, T } from '@/ui/kit';
import { TrackList, TrackRow } from '@/ui/music';
import { BOTTOM_PAD, SPACE } from '@/ui/theme';

type Version = 'all' | 'original' | 'clean';
const PAGE = 25;

export default function Search() {
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [source, setSource] = useState<string | null>(null);
  const [version, setVersion] = useState<Version>('all');
  const [limit, setLimit] = useState(PAGE);
  const [showLoose, setShowLoose] = useState(false);
  const fullOnly = useSettings((x) => x.fullOnly);
  const set = useSettings((x) => x.set);
  useEffect(() => { const t = setTimeout(() => { setQ(text.trim()); setLimit(PAGE); setShowLoose(false); }, 420); return () => clearTimeout(t); }, [text]);
  const link = isLink(q);
  const r = useQuery({ queryKey: ['search', q], queryFn: () => federatedSearch(q), enabled: q.length >= 2 && !link });
  const l = useQuery({ queryKey: ['search-link', q], queryFn: () => searchLink(q), enabled: link, retry: 0 });
  const radio = useQuery({ queryKey: ['radio-search', q], queryFn: () => radioResults(q), enabled: q.length >= 2 && source === 'radio' && !link });

  const tracks = useMemo(() => (r.data?.tracks ?? []).filter((t) => {
    const p = t.preferred;
    if (!p || p.isLive) return false;
    if (fullOnly && playMode(p) !== 'player') return false;
    if (source && source !== 'radio' && !t.sources.some((x) => x.source === source)) return false;
    const st = effectiveExplicit(p);
    if (version === 'original' && st === 'clean') return false;
    if (version === 'clean' && st !== 'clean') return false;
    return true;
  }), [r.data, fullOnly, source, version]);
  const sources = [...new Set((r.data?.tracks ?? []).flatMap((t) => t.sources.map((x) => x.source)))];
  const top = r.data?.topArtist;
  const otherArtists = (r.data?.artists ?? []).filter((a) => a !== top).slice(0, 10);
  const openArtist = (name: string, src: string, id: string) => router.push({ pathname: '/artist/[name]', params: { name, ...(src === 'deezer' ? { deezer: id } : {}) } });

  return (
    <View style={{ flex: 1 }}>
      <Ambient strength={0.8} />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingTop: insets.top + 14, paddingHorizontal: SPACE.page, paddingBottom: BOTTOM_PAD }}>
        <T v="h1" style={{ marginBottom: 14 }} accessibilityRole="header">Поиск</T>
        <Field testID="search-input" icon="search" placeholder="Песня, исполнитель или ссылка" value={text} onChangeText={setText} returnKeyType="search" autoCorrect={false} autoCapitalize="none" />

        {q.length < 2 ? <>
          <T v="h3" style={{ marginBottom: 10, marginTop: 6 }}>Жанры</T>
          <View style={ks.wrap}>{GENRES.map(([id, label]) => <Chip key={id} label={label} onPress={() => setText(id)} />)}</View>
          <Press accessibilityRole="link" onPress={() => router.push('/radio')} style={{ marginTop: 24 }}>
            <Glass style={{ padding: 18 }}><T v="h2">Интернет-радио</T><T v="small" c="muted" style={{ marginTop: 4 }}>Живой эфир станций со всего мира, в том числе российских</T></Glass>
          </Press>
          <Notice title="Ссылки тоже работают" text="Вставьте ссылку на SoundCloud или YouTube: откроется их официальный плеер. В России для них нужен VPN. Ссылки Deezer, Audius и Internet Archive открываются как альбом или плейлист." />
        </> : null}

        {link ? <>
          {l.isLoading ? <Loading label="Открываем ссылку" /> : null}
          {l.isError ? <Notice tone="danger" text={friendlyError(l.error)} /> : null}
          {l.data ? <Section title={l.data.title} note={sourceName(l.data.source)}>
            <TrackList tracks={l.data.tracks} context="link" />
            {l.data.tracks.length > 1 ? <Btn label="Сохранить как плейлист" kind="line" style={{ marginTop: 12 }} onPress={async () => {
              const id = await repo.createPlaylist({ name: l.data!.title, imported: true, importedFrom: sourceName(l.data!.source) });
              await repo.addPlaylistItems(id, l.data!.tracks.map((t, i) => ({ trackId: t.id, status: 'matched' as const, rawTitle: t.title, rawArtist: t.artist, rawAlbum: t.album, rawDurationSec: t.durationSec, rawIsrc: t.isrc, originalPosition: i })));
              bumpData(); toast('Плейлист сохранён');
            }} /> : null}
          </Section> : null}
        </> : null}

        {!link && r.isLoading ? <Loading label="Ищем в каталоге и во всех подключённых источниках" /> : null}
        {!link && r.isError ? <Notice tone="danger" text={friendlyError(r.error)} /> : null}
        {!link && r.data ? <View testID="search-results">
          {r.data.errors.length ? <Notice tone="warn" text={`Не ответили: ${r.data.errors.map((e) => `${e.source} (${e.message})`).join('; ')}`} /> : null}

          {top ? <Press testID="top-artist" accessibilityRole="link" onPress={() => openArtist(top.name, top.source, top.id)} style={{ marginTop: 6 }}>
            <Glass style={{ padding: 14, flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <Cover uri={top.imageUrl} title={top.name} size={72} radius={36} />
              <View style={{ flex: 1 }}>
                <T v="h2" numberOfLines={1}>{top.name}</T>
                <T v="small" c="muted">Исполнитель{top.followers ? `, ${top.followers.toLocaleString('ru-RU')} слушателей в Deezer` : ''}</T>
              </View>
              <T v="strong" c="accent">Открыть</T>
            </Glass>
          </Press> : null}

          <View style={{ height: 14 }} />
          <Shelf>
            <Chip label="Всё" on={!fullOnly && version === 'all' && !source} onPress={() => { set({ fullOnly: false }); setVersion('all'); setSource(null); }} />
            <Chip label="Можно целиком" on={fullOnly} onPress={() => set({ fullOnly: !fullOnly })} />
            <Chip label="Без цензурированных" on={version === 'original'} onPress={() => setVersion(version === 'original' ? 'all' : 'original')} />
            <Chip label="Только цензурированные" on={version === 'clean'} onPress={() => setVersion(version === 'clean' ? 'all' : 'clean')} />
            <Chip label="Радио" on={source === 'radio'} onPress={() => setSource(source === 'radio' ? null : 'radio')} />
          </Shelf>
          {sources.length > 1 && source !== 'radio' ? <><View style={{ height: 8 }} /><Shelf>{sources.map((x) => <Chip key={x} label={sourceName(x)} on={source === x} onPress={() => setSource(source === x ? null : x)} />)}</Shelf></> : null}

          {source === 'radio' ? <Section title="Станции">{radio.isLoading ? <Loading /> : null}{radio.data?.map((t, i) => <TrackRow key={t.id} t={t} onPress={() => void playTracks([radio.data![i]], 0, 'radio-station')} />)}</Section> : <>
            <Section title="Треки" note="«Целиком» играет здесь полностью, «фрагмент» звучит 30 секунд. Полная версия фрагментов: «⋯» → Яндекс Музыка, VK или Звук.">
              {tracks.length ? <>
                <TrackList tracks={tracks.slice(0, limit)} context="search" />
                {tracks.length > limit ? <Btn label={`Показать ещё ${Math.min(PAGE, tracks.length - limit)}`} kind="line" onPress={() => setLimit(limit + PAGE)} style={{ marginTop: 8 }} /> : null}
              </> : <Empty title="Ничего подходящего" text={fullOnly ? 'Целиком эта песня здесь не играет. Снимите «Можно целиком», чтобы увидеть фрагменты и ссылки.' : 'Попробуйте другой запрос или проверьте интернет.'} />}
            </Section>
            {r.data.albums.length ? <Section title="Альбомы"><Shelf>{r.data.albums.slice(0, 12).map((a) => (
              <Press key={`${a.source}${a.id}`} accessibilityRole="link" onPress={() => router.push({ pathname: '/album/[source]/[id]', params: { source: a.source, id: a.id, title: a.title } })} style={{ width: 150 }}>
                <Cover uri={a.coverUrl} title={a.title} size={150} radius={18} /><T v="title" numberOfLines={1} style={{ marginTop: 7 }}>{a.title}</T><T v="small" c="muted" numberOfLines={1}>{a.artist}{a.year ? `, ${a.year}` : ''}</T>
              </Press>))}</Shelf></Section> : null}
            {otherArtists.length ? <Section title={top ? 'Другие исполнители' : 'Исполнители'}><Shelf>{otherArtists.map((a) => (
              <Press key={`${a.source}${a.id}`} accessibilityRole="link" onPress={() => openArtist(a.name, a.source, a.id)} style={{ width: 92, alignItems: 'center' }}>
                <Cover uri={a.imageUrl} title={a.name} size={84} radius={42} /><T v="small" numberOfLines={2} style={{ marginTop: 6, textAlign: 'center' }}>{a.name}</T>
              </Press>))}</Shelf></Section> : null}
            {r.data.playlists.length ? <Section title="Плейлисты"><Shelf>{r.data.playlists.map((p) => (
              <Press key={`${p.source}${p.id}`} accessibilityRole="link" onPress={() => router.push({ pathname: '/album/[source]/[id]', params: { source: p.source, id: p.id, title: p.title, playlist: '1' } })} style={{ width: 150 }}>
                <Cover uri={p.coverUrl} title={p.title} size={150} radius={18} /><T v="title" numberOfLines={1} style={{ marginTop: 7 }}>{p.title}</T><T v="small" c="faint">{sourceName(p.source)}</T>
              </Press>))}</Shelf></Section> : null}
            {r.data.loose.length ? <Section title="Похожие названия" note="Свободные каталоги нашли это по отдельным словам. Скорее всего, это другие исполнители.">
              {showLoose ? <TrackList tracks={r.data.loose} context="search" /> : <Btn label={`Показать ${r.data.loose.length}`} kind="line" onPress={() => setShowLoose(true)} style={{ alignSelf: 'flex-start' }} />}
            </Section> : null}
            <Section title="Слушать полностью" note="Откроется поиск в официальном приложении или на сайте сервиса.">
              <View style={ks.wrap}>{LISTEN_ELSEWHERE.map((id) => adapter(id)).filter((a) => a?.externalUrl).map((a) => <Chip key={a!.id} icon="link" label={a!.name} onPress={() => { const u = a!.externalUrl!({ title: q, artist: '' }); if (u) void Linking.openURL(u); }} />)}</View>
            </Section>
            <T v="small" c="faint" style={{ marginTop: 18 }}>Искали: {r.data.searched.join(', ')}. Данные каталога: Deezer.</T>
          </>}
        </View> : null}
      </ScrollView>
    </View>
  );
}
