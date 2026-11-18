import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { View } from 'react-native';
import * as repo from '@/db/repo';
import { applySmartRule, type SmartRule } from '@/reco/extras';
import { loadReco, topFeatures } from '@/services/reco';
import { bumpData, playTracks, toast } from '@/state/app';
import { Btn, Chip, Empty, Loading, Screen, s as ks, T } from '@/ui/kit';
import { TrackList } from '@/ui/music';

interface Option { label: string; rule: SmartRule }
const FIXED: Option[] = [
  { label: 'Самое слушаемое', rule: { kind: 'most_played' } }, { label: 'Ещё не слушали', rule: { kind: 'unplayed' } }, { label: 'Любимое', rule: { kind: 'liked_recent' } },
  { label: 'Спокойный темп', rule: { kind: 'tempo', value: 'slow' } }, { label: 'Средний темп', rule: { kind: 'tempo', value: 'medium' } }, { label: 'Быстрый темп', rule: { kind: 'tempo', value: 'fast' } },
];

export default function Smart() {
  const [sel, setSel] = useState<Option>(FIXED[0]);
  const q = useQuery({
    queryKey: ['smart'],
    queryFn: async () => {
      const { tracks, profile, pool } = await loadReco(true);
      const all = [...new Map([...tracks.values(), ...pool].map((t) => [t.id, t])).values()].filter((t) => t.preferred?.availability === 'full' && !t.preferred.isLive);
      const moods = [...new Set(all.map((t) => t.mood).filter(Boolean))].slice(0, 8) as string[];
      const decades = [...new Set(all.flatMap((t) => (t.year ? [Math.floor(t.year / 10) * 10] : [])))].sort().slice(-6);
      return { all, profile, options: [...FIXED, ...topFeatures(profile, 't:', 8).map((v): Option => ({ label: v, rule: { kind: 'tag', value: v } })), ...moods.map((v): Option => ({ label: v, rule: { kind: 'mood', value: v } })), ...decades.map((v): Option => ({ label: `${v}-е`, rule: { kind: 'decade', value: String(v) } }))] };
    },
  });
  const tracks = q.data ? applySmartRule(sel.rule, q.data.all, q.data.profile).slice(0, 100) : [];
  return (
    <Screen title="Умные плейлисты">
      {q.isLoading ? <Loading /> : null}
      <View style={ks.wrap}>{q.data?.options.map((o) => <Chip key={o.label} label={o.label} on={o.label === sel.label} onPress={() => setSel(o)} />)}</View>
      <View style={{ flexDirection: 'row', gap: 10, marginVertical: 14 }}>
        <Btn label="Слушать" icon="play" disabled={!tracks.length} onPress={() => void playTracks(tracks, 0, 'smart')} style={{ flex: 1 }} />
        <Btn label="Сохранить" kind="line" disabled={!tracks.length} onPress={async () => { const id = await repo.createPlaylist({ name: sel.label }); await repo.addPlaylistItems(id, tracks.map((t) => ({ trackId: t.id, status: 'matched' as const, rawTitle: t.title, rawArtist: t.artist, rawAlbum: t.album, rawDurationSec: t.durationSec, rawIsrc: t.isrc }))); bumpData(); toast('Плейлист сохранён'); }} />
      </View>
      {tracks.length ? <TrackList tracks={tracks} context="smart" /> : q.data ? <Empty title="Подходящих треков нет" text="Выберите другое правило или послушайте больше музыки." /> : null}
      <T v="small" c="muted" style={{ marginTop: 14 }}>Темп и настроение есть не у всех источников, поэтому такие подборки зависят от данных каталога.</T>
    </Screen>
  );
}
