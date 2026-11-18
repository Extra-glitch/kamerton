import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { effectiveExplicit } from '@/core/choose';
import { GENRES } from '@/core/genres';
import { friendlyError } from '@/net/http';
import { adapter, ADAPTERS, sourceName } from '@/sources/registry';
import { federatedSearch, radioResults } from '@/services/media';
import { playTracks } from '@/state/app';
import { useSettings } from '@/state/settings';
import { Chip, Cover, Empty, Field, Loading, Notice, Section, Shelf, s as ks, SwitchRow, T } from '@/ui/kit';
import { TrackList, TrackRow } from '@/ui/music';
import { BOTTOM_PAD, SPACE, useColors } from '@/ui/theme';

type Version = 'all' | 'original' | 'clean';

export default function Search() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [source, setSource] = useState<string | null>(null);
  const [artist, setArtist] = useState<string | null>(null);
  const [version, setVersion] = useState<Version>('all');
  const onlyFull = useSettings((x) => x.onlyFull);
  const set = useSettings((x) => x.set);
  useEffect(() => { const t = setTimeout(() => { setQ(text.trim()); setArtist(null); }, 420); return () => clearTimeout(t); }, [text]);
  const r = useQuery({ queryKey: ['search', q], queryFn: () => federatedSearch(q), enabled: q.length >= 2 });
  const radio = useQuery({ queryKey: ['radio-search', q], queryFn: () => radioResults(q), enabled: q.length >= 2 && source === 'radio' });

  const tracks = useMemo(() => (r.data?.tracks ?? []).filter((t) => {
    const p = t.preferred;
    if (!p || p.isLive) return false;
    if (onlyFull && !(p.availability === 'full' && adapter(p.source)?.resolveStream)) return false;
    if (source && !t.sources.some((x) => x.source === source)) return false;
    if (artist && t.artist !== artist) return false;
    const st = effectiveExplicit(p);
    if (version === 'original' && st === 'clean') return false;
    if (version === 'clean' && st !== 'clean') return false;
    return true;
  }), [r.data, onlyFull, source, artist, version]);
  const sources = [...new Set((r.data?.tracks ?? []).flatMap((t) => t.sources.map((x) => x.source)))];
  const artists = [...new Set(tracks.map((t) => t.artist))].slice(0, 8);
  const external = ADAPTERS.filter((a) => a.capabilities.playback !== 'direct-stream' && a.externalUrl && ['yandex', 'vk', 'spotify', 'soundcloud'].includes(a.id));

  return (
    <ScrollView style={{ backgroundColor: c.bg }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingTop: insets.top + 14, paddingHorizontal: SPACE.page, paddingBottom: BOTTOM_PAD }}>
      <T v="h1" style={{ marginBottom: 12 }} accessibilityRole="header">Поиск</T>
      <Field testID="search-input" placeholder="Песня, исполнитель, альбом, жанр" value={text} onChangeText={setText} returnKeyType="search" autoCorrect={false} />
      {q.length < 2 ? <>
        <T v="h3" style={{ marginBottom: 10 }}>Жанры</T>
        <View style={ks.wrap}>{GENRES.map(([id, label]) => <Chip key={id} label={label} onPress={() => setText(id)} />)}</View>
        <Pressable accessibilityRole="link" onPress={() => router.push('/radio')} style={{ marginTop: 28 }}><T v="h2">Интернет-радио</T><T v="small" c="muted">Живой эфир станций со всего мира</T></Pressable>
      </> : null}
      {r.isLoading ? <Loading label="Ищем сразу во всех подключённых источниках" /> : null}
      {r.isError ? <Notice tone="danger" text={friendlyError(r.error)} /> : null}
      {r.data ? <>
        <T v="small" c="muted">Искали: {r.data.searched.join(', ')}</T>
        {r.data.errors.map((e) => <Notice key={e.source} tone="warn" text={`${e.source}: ${e.message}`} />)}
        <SwitchRow title="Только целиком" sub="Без фрагментов и переходов в другие сервисы" value={onlyFull} onChange={(v) => set({ onlyFull: v })} />
        <Shelf>
          <Chip label="Все источники" on={!source} onPress={() => setSource(null)} />
          {sources.map((x) => <Chip key={x} label={sourceName(x)} on={source === x} onPress={() => setSource(x)} />)}
          <Chip label="Радио" on={source === 'radio'} onPress={() => setSource('radio')} />
        </Shelf>
        <View style={{ height: 8 }} />
        <Shelf>
          <Chip label="Все версии" on={version === 'all'} onPress={() => setVersion('all')} />
          <Chip label="Без цензурированных" on={version === 'original'} onPress={() => setVersion('original')} />
          <Chip label="Только цензурированные" on={version === 'clean'} onPress={() => setVersion('clean')} />
        </Shelf>
        {artists.length > 1 ? <><View style={{ height: 8 }} /><Shelf>{artists.map((a) => <Chip key={a} label={a} on={artist === a} onPress={() => setArtist(artist === a ? null : a)} />)}</Shelf></> : null}
        {source === 'radio' ? <Section title="Станции">{radio.isLoading ? <Loading /> : null}{radio.data?.map((t, i) => <TrackRow key={t.id} t={t} onPress={() => void playTracks([radio.data![i]], 0, 'radio-station')} />)}</Section> : <>
          {r.data.artists.length ? <Section title="Исполнители"><Shelf>{r.data.artists.map((a) => (
            <Pressable key={`${a.source}${a.id}`} accessibilityRole="link" onPress={() => router.push({ pathname: '/artist/[name]', params: { name: a.name, source: a.source, id: a.id } })} style={{ width: 96 }}>
              <Cover uri={a.imageUrl} title={a.name} size={96} radius={48} /><T v="small" numberOfLines={2} style={{ marginTop: 5 }}>{a.name}</T>
            </Pressable>))}</Shelf></Section> : null}
          <Section title="Композиции">{tracks.length ? <TrackList tracks={tracks} context="search" /> : <Empty title="Ничего подходящего" text={onlyFull ? 'Попробуйте отключить «Только целиком» или изменить запрос.' : 'Попробуйте другой запрос или подключите ещё один источник.'} />}</Section>
          {r.data.albums.length ? <Section title="Альбомы"><Shelf>{r.data.albums.map((a) => (
            <Pressable key={`${a.source}${a.id}`} accessibilityRole="link" onPress={() => router.push({ pathname: '/album/[source]/[id]', params: { source: a.source, id: a.id, title: a.title } })} style={{ width: 150 }}>
              <Cover uri={a.coverUrl} title={a.title} size={150} /><T v="title" numberOfLines={1} style={{ marginTop: 6 }}>{a.title}</T><T v="small" c="muted" numberOfLines={1}>{a.artist}</T><T v="small" c="faint">{sourceName(a.source)}</T>
            </Pressable>))}</Shelf></Section> : null}
          {r.data.playlists.length ? <Section title="Плейлисты"><Shelf>{r.data.playlists.map((p) => (
            <Pressable key={`${p.source}${p.id}`} accessibilityRole="link" onPress={() => router.push({ pathname: '/album/[source]/[id]', params: { source: p.source, id: p.id, title: p.title, playlist: '1' } })} style={{ width: 150 }}>
              <Cover uri={p.coverUrl} title={p.title} size={150} /><T v="title" numberOfLines={1} style={{ marginTop: 6 }}>{p.title}</T><T v="small" c="faint">{sourceName(p.source)}</T>
            </Pressable>))}</Shelf></Section> : null}
          <Section title="Искать в других сервисах" note="Откроется официальный сайт или приложение. Здесь эти сервисы не играют.">
            <View style={ks.wrap}>{external.map((a) => <Chip key={a.id} label={a.name} onPress={() => { const u = a.externalUrl!({ title: q, artist: '' }); if (u) void Linking.openURL(u); }} />)}</View>
          </Section>
        </>}
      </> : null}
    </ScrollView>
  );
}
