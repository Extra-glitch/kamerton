import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { effectiveExplicit } from '@/core/choose';
import { GENRES } from '@/core/genres';
import * as repo from '@/db/repo';
import { friendlyError } from '@/net/http';
import { loadMore, runSearch, STATE_TEXT, useSearch, type ProviderRun, type SearchGroup } from '@/search/engine';
import { adapter, LISTEN_ELSEWHERE, playMode, sourceName } from '@/sources/registry';
import { useYouTubeReady } from '@/services/fullVersion';
import { isLink, searchLink } from '@/services/media';
import { bumpData, toast } from '@/state/app';
import { useSettings } from '@/state/settings';
import { Ambient } from '@/ui/ambient';
import { Glass } from '@/ui/glass';
import { Icon } from '@/ui/icons';
import { Btn, Chip, Cover, Empty, Field, Loading, Notice, Press, Section, Shelf, s as ks, T, useBottomPad } from '@/ui/kit';
import { TrackList } from '@/ui/music';
import { canPlayViaYouTube } from '@/ui/musicBadge';
import { SPACE, TYPE, useColors } from '@/ui/theme';

type Version = 'all' | 'original' | 'clean';
const PAGE = 30;
const GROUPS: [SearchGroup, string][] = [['songs', 'Песни'], ['archive', 'Архив'], ['radio', 'Радио']];

/** Плашка источника: сколько нашёл, ищет ли ещё, нужен ли ключ. Нажатие показывает только его результаты. */
function ProviderPill({ r, on, onPress }: { r: ProviderRun; on: boolean; onPress: () => void }) {
  const c = useColors();
  const tone = r.state === 'ok' ? c.text : r.state === 'needs_setup' ? c.faint : r.state === 'error' || r.state === 'timeout' ? c.warn : c.muted;
  return (
    <Pressable testID={`provider-${r.id}`} accessibilityRole="button" accessibilityLabel={`${r.name}: ${STATE_TEXT[r.state]}, найдено ${r.matched}`} onPress={onPress}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, height: 34, borderRadius: 17, borderWidth: 1, borderColor: on ? c.accent : c.stroke, backgroundColor: on ? c.accentSoft : c.glass }}>
      {r.state === 'pending' ? <ActivityIndicator size="small" color={c.accent} /> : null}
      {r.state === 'needs_setup' ? <Icon name="link" size={14} color={c.faint} /> : null}
      <Text style={[TYPE.small, { color: tone, fontFamily: 'Body-500' }]}>{r.name}{r.state === 'ok' || r.state === 'empty' ? ` ${r.matched}` : r.state === 'error' || r.state === 'timeout' ? ' !' : ''}</Text>
    </Pressable>
  );
}

/** Главное, что нужно для прослушивания целиком: подключить YouTube. */
function FullListeningCard() {
  const c = useColors();
  // Компактная строка, а не большое окно: она не должна отодвигать результаты поиска.
  return (
    <Press testID="connect-youtube" accessibilityRole="button" accessibilityLabel="Подключить YouTube, чтобы песни играли целиком" onPress={() => router.push({ pathname: '/sources/[id]', params: { id: 'youtube' } })} style={{ marginTop: 8 }}>
      <Glass radius={16} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 14 }}>
        <View style={{ flex: 1 }}>
          <T v="strong">Песни звучат фрагментом 30 секунд</T>
          <T v="small" c="muted">Подключите YouTube (бесплатно), чтобы слушать целиком</T>
        </View>
        <T v="strong" c="accent">Подключить</T>
        <Icon name="forward" size={18} color={c.accent} />
      </Glass>
    </Press>
  );
}

export default function Search() {
  const bottomPad = useBottomPad();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [group, setGroup] = useState<SearchGroup>('songs');
  const [only, setOnly] = useState<string | null>(null);
  const [version, setVersion] = useState<Version>('all');
  const [limit, setLimit] = useState(PAGE);
  const [showLoose, setShowLoose] = useState(false);
  const [moreBusy, setMoreBusy] = useState(false);
  const fullOnly = useSettings((x) => x.fullOnly);
  const yt = useYouTubeReady((y) => y.ready);
  const set = useSettings((x) => x.set);
  const s = useSearch();
  useEffect(() => { const t = setTimeout(() => setQ(text.trim()), 450); return () => clearTimeout(t); }, [text]);
  const link = isLink(q);
  useEffect(() => {
    setLimit(PAGE); setShowLoose(false); setOnly(null);
    if (q.length >= 2 && !link) void runSearch(q, group);
  }, [q, group, link]);
  const l = useQuery({ queryKey: ['search-link', q], queryFn: () => searchLink(q), enabled: link, retry: 0 });

  const active = s.q === q && s.group === group;
  const tracks = useMemo(() => (active ? s.tracks : []).filter((t) => {
    const p = t.preferred;
    if (!p) return false;
    if (only && !t.sources.some((x) => x.source === only)) return false;
    if (fullOnly && playMode(p) !== 'player' && playMode(p) !== 'embed' && !(yt && canPlayViaYouTube(p))) return false;
    const st = effectiveExplicit(p);
    if (version === 'original' && st === 'clean') return false;
    if (version === 'clean' && st !== 'clean') return false;
    return true;
  }), [active, s.tracks, only, fullOnly, version, yt]);
  const top = active ? s.topArtist : null;
  const otherArtists = (active ? s.artists : []).filter((a) => a !== top).slice(0, 10);
  const pending = active && !s.done;
  const canMore = active && s.runs.some((r) => r.hasMore && (!only || r.id === only));
  const setup = active ? s.runs.filter((r) => r.state === 'needs_setup') : [];
  const failed = active ? s.runs.filter((r) => r.state === 'error' || r.state === 'timeout') : [];
  const openArtist = (name: string, src: string, id: string) => router.push({ pathname: '/artist/[name]', params: { name, ...(src === 'deezer' ? { deezer: id } : {}) } });

  return (
    <View style={{ flex: 1 }}>
      <Ambient strength={0.8} />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingTop: insets.top + 14, paddingHorizontal: SPACE.page, paddingBottom: bottomPad }}>
        <T v="h1" style={{ marginBottom: 14 }} accessibilityRole="header">Поиск</T>
        <Field testID="search-input" icon="search" placeholder="Песня, исполнитель или ссылка" value={text} onChangeText={setText} returnKeyType="search" autoCorrect={false} autoCapitalize="none" />
        <View style={[ks.wrap, { marginTop: -4, marginBottom: 6 }]}>{GROUPS.map(([g, label]) => <Chip key={g} label={label} on={group === g} onPress={() => setGroup(g)} />)}</View>

        {!yt && group === 'songs' ? <FullListeningCard /> : null}
        {q.length < 2 ? <>
          <T v="h3" style={{ marginBottom: 10, marginTop: 14 }}>Жанры</T>
          <View style={ks.wrap}>{GENRES.map(([id, label]) => <Chip key={id} label={label} onPress={() => setText(id)} />)}</View>
          <Press accessibilityRole="link" onPress={() => router.push('/radio')} style={{ marginTop: 24 }}>
            <Glass style={{ padding: 18 }}><T v="h2">Интернет-радио</T><T v="small" c="muted" style={{ marginTop: 4 }}>Живой эфир станций со всего мира, в том числе российских</T></Glass>
          </Press>
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

        {!link && q.length >= 2 ? <View testID="search-results">
          {active && s.runs.length ? <View style={{ marginTop: 8 }}>
            {/* Неподключённые источники здесь не показываем: их список есть в «Диагностике источников». */}
            <Shelf>{s.runs.filter((r) => r.state !== 'needs_setup').map((r) => <ProviderPill key={r.id} r={r} on={only === r.id} onPress={() => setOnly(only === r.id ? null : r.id)} />)}</Shelf>
          </View> : null}

          {top && group === 'songs' ? <Press testID="top-artist" accessibilityRole="link" accessibilityLabel={`Открыть исполнителя: ${top.name}`} onPress={() => openArtist(top.name, top.source, top.id)} style={{ marginTop: 14 }}>
            <Glass style={{ padding: 14, flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <Cover uri={top.imageUrl} title={top.name} size={64} radius={32} />
              <View style={{ flex: 1 }}>
                <T v="h2" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{top.name}</T>
                <T v="small" c="muted">Исполнитель{top.followers && top.source === 'deezer' ? `, ${top.followers.toLocaleString('ru-RU')} слушателей` : ''}</T>
              </View>
              <Icon name="forward" size={22} color={c.accent} />
            </Glass>
          </Press> : null}

          {group === 'songs' ? <View style={{ marginTop: 12 }}><Shelf>
            <Chip label="Можно слушать" on={fullOnly} onPress={() => set({ fullOnly: !fullOnly })} />
            <Chip label="Без цензурированных" on={version === 'original'} onPress={() => setVersion(version === 'original' ? 'all' : 'original')} />
            <Chip label="Только цензурированные" on={version === 'clean'} onPress={() => setVersion(version === 'clean' ? 'all' : 'clean')} />
          </Shelf></View> : null}

          <Section title={group === 'radio' ? 'Станции' : group === 'archive' ? 'Архив' : only ? `Треки: ${sourceName(only)}` : 'Треки'}>
            {tracks.length ? <>
              <TrackList tracks={tracks.slice(0, limit)} context={group === 'radio' ? 'radio-station' : 'search'} showSources={group === 'songs'} />
              {tracks.length > limit ? <Btn label={`Показать ещё ${Math.min(PAGE, tracks.length - limit)}`} kind="line" onPress={() => setLimit(limit + PAGE)} style={{ marginTop: 8 }} /> : null}
              {tracks.length <= limit && canMore ? <Btn label="Найти ещё в источниках" kind="line" busy={moreBusy} onPress={async () => { setMoreBusy(true); await loadMore(only ?? undefined); setMoreBusy(false); setLimit(limit + PAGE); }} style={{ marginTop: 8 }} /> : null}
            </> : null}
            {pending ? <Loading label={`Ищем: ${s.runs.filter((r) => r.state === 'pending').map((r) => r.name).join(', ') || 'источники'}`} /> : null}
            {!pending && active && !tracks.length ? <Empty title="Ничего не нашлось" text={[
              fullOnly ? 'Включён фильтр «Можно слушать»: снимите его, чтобы увидеть песни из каталогов.' : null,
              failed.length ? `Не ответили: ${failed.map((r) => `${r.name} (${r.error})`).join('; ')}.` : null,
              setup.length ? `Не подключены: ${setup.map((r) => r.name).join(', ')}.` : null,
              'Подробности по каждому источнику: Профиль → Диагностика источников.',
            ].filter(Boolean).join(' ')} /> : null}
          </Section>

          {active && s.albums.length && group === 'songs' ? <Section title="Альбомы"><Shelf>{s.albums.slice(0, 12).map((a) => (
            <Press key={`${a.source}${a.id}`} accessibilityRole="link" onPress={() => router.push({ pathname: '/album/[source]/[id]', params: { source: a.source, id: a.id, title: a.title } })} style={{ width: 150 }}>
              <Cover uri={a.coverUrl} title={a.title} size={150} radius={18} /><T v="title" numberOfLines={1} style={{ marginTop: 7 }}>{a.title}</T><T v="small" c="muted" numberOfLines={1}>{a.artist}{a.year ? `, ${a.year}` : ''}</T>
            </Press>))}</Shelf></Section> : null}
          {otherArtists.length && group === 'songs' ? <Section title={top ? 'Другие исполнители' : 'Исполнители'}><Shelf>{otherArtists.map((a) => (
            <Press key={`${a.source}${a.id}`} accessibilityRole="link" onPress={() => openArtist(a.name, a.source, a.id)} style={{ width: 92, alignItems: 'center' }}>
              <Cover uri={a.imageUrl} title={a.name} size={84} radius={42} /><T v="small" numberOfLines={2} style={{ marginTop: 6, textAlign: 'center' }}>{a.name}</T>
            </Press>))}</Shelf></Section> : null}
          {active && s.loose.length ? <Section title="Похожие названия">
            {showLoose ? <TrackList tracks={s.loose} context="search" showSources /> : <Btn label={`Показать ещё ${s.loose.length} с похожими словами`} kind="quiet" onPress={() => setShowLoose(true)} />}
          </Section> : null}
          {group === 'songs' && active && s.done ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 26, alignItems: 'center' }}>
            <T v="small" c="faint">Открыть поиск в:</T>
            {LISTEN_ELSEWHERE.map((id) => adapter(id)).filter((a) => a?.externalUrl).map((a) => <Chip key={a!.id} label={a!.name} onPress={() => { const u = a!.externalUrl!({ title: q, artist: '' }); if (u) void Linking.openURL(u); }} />)}
          </View> : null}
        </View> : null}
      </ScrollView>
    </View>
  );
}
