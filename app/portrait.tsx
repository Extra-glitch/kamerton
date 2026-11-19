import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { View } from 'react-native';
import * as repo from '@/db/repo';
import { buildPortrait } from '@/reco/extras';
import { loadReco } from '@/services/reco';
import { Choice, Empty, Screen, T } from '@/ui/kit';
import { FONT, useColors } from '@/ui/theme';

const RANGE = { '30': 30, '365': 365, all: 0 } as const;

export default function PortraitScreen() {
  const c = useColors();
  const [range, setRange] = useState<keyof typeof RANGE>('365');
  const q = useQuery({ queryKey: ['portrait', range], queryFn: async () => buildPortrait(await repo.getPlays(), (await loadReco(true)).tracks, RANGE[range] ? Date.now() - RANGE[range] * 86_400_000 : 0), staleTime: 0 });
  const p = q.data;
  const peak = p ? Math.max(1, ...p.byHour) : 1;
  const maxTag = p?.topTags[0]?.share ?? 1;
  return (
    <Screen title="Портрет">
      <Choice value={range} onChange={setRange} options={[{ value: '30', label: 'Месяц' }, { value: '365', label: 'Год' }, { value: 'all', label: 'Всё время' }]} />
      {p && !p.plays ? <Empty title="Портрет пока пуст" text="Он появится после первых прослушиваний. Минимум пять секунд на трек." /> : null}
      {p && p.plays ? <>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 22, marginTop: 20 }}>
          {[[p.hours.toFixed(1).replace('.', ','), 'часов'], [p.tracks, 'треков'], [p.discoveries, 'новых исполнителей'], [`${Math.round(p.completion * 100)}%`, 'дослушано']].map(([v, l]) => <View key={String(l)}><T v="h1">{v}</T><T v="small" c="muted">{l}</T></View>)}
        </View>
        {p.topTags.length ? <View style={{ marginTop: 32 }}>
          <T v="h2" style={{ marginBottom: 10 }}>Ваш звук</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 12 }}>
            {p.topTags.map((t, i) => { const size = 16 + 22 * (t.share / maxTag); return <T key={t.name} style={{ fontFamily: FONT.d8, fontSize: size, lineHeight: size * 1.04, color: i === 0 ? c.accent : i < 4 ? c.text : c.muted }}>{t.name}</T>; })}
          </View>
        </View> : null}
        <View style={{ marginTop: 32 }}>
          <T v="h2" style={{ marginBottom: 8 }}>Исполнители</T>
          {p.topArtists.map((a) => <View key={a.name} style={{ marginBottom: 9 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><T v="title">{a.name}</T><T v="small" c="muted">{Math.round(a.minutes)} мин</T></View>
            <View style={{ height: 4, backgroundColor: c.line, marginTop: 3 }}><View style={{ height: 4, width: `${Math.max(2, a.share * 100)}%`, backgroundColor: c.accent }} /></View>
          </View>)}
        </View>
        {p.decades.length ? <View style={{ marginTop: 28 }}>
          <T v="h2" style={{ marginBottom: 10 }}>Эпохи</T>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10, height: 120 }}>
            {p.decades.map((d) => <View key={d.decade} style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}><View style={{ width: '100%', height: `${Math.max(4, d.share * 85)}%`, backgroundColor: c.accent }} /><T v="small" c="muted" numberOfLines={1}>{String(d.decade).slice(2)}-е</T></View>)}
          </View>
        </View> : null}
        <View style={{ marginTop: 28 }}>
          <T v="h2" style={{ marginBottom: 10 }}>Время суток</T>
          <View accessible accessibilityLabel="Прослушивание по часам" style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 60 }}>{p.byHour.map((m, h) => <View key={h} style={{ flex: 1, height: `${Math.max(3, (m / peak) * 100)}%`, backgroundColor: m === peak ? c.accent : c.line }} />)}</View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><T v="small" c="muted">0:00</T><T v="small" c="muted">12:00</T><T v="small" c="muted">23:00</T></View>
        </View>
      </> : null}
    </Screen>
  );
}
