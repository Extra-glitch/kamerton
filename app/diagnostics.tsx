// Диагностика музыкальных источников: что подключено, кто ответил на поиск, сколько нашёл и почему нет.

import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { sourceContext as ctx } from '@/platform/secureConfig';
import { PROVIDERS, runSearch, STATE_TEXT, useSearch, useSearchLog, type ProviderRun, type SearchSnapshot } from '@/search/engine';
import { adapter } from '@/sources/registry';
import { Glass } from '@/ui/glass';
import { Badge, Btn, Field, Row, Screen, Section, T } from '@/ui/kit';
import { useColors } from '@/ui/theme';

const GROUP_NAME: Record<string, string> = { songs: 'Поиск песен', archive: 'Архив', radio: 'Радио' };

function explain(r: ProviderRun): string {
  if (r.state === 'needs_setup') return r.hint ?? 'Источник не подключён.';
  if (r.state === 'pending') return 'Ещё ищет.';
  if (r.state === 'timeout' || r.state === 'error') return r.error ?? 'Ошибка.';
  if (r.received === 0) return 'Источник ответил, но ничего не нашёл.';
  if (r.matched === 0) return `Получено ${r.received}, но ни один результат не совпал с запросом: они в блоке «Похожие названия».`;
  return `Получено ${r.received}, подходит ${r.matched}${r.received > r.matched ? `, остальные убраны как случайные совпадения` : ''}.`;
}

function RunCard({ r }: { r: ProviderRun }) {
  const tone = r.state === 'ok' ? 'ok' : r.state === 'needs_setup' ? 'faint' : r.state === 'empty' || r.state === 'pending' ? 'muted' : 'warn';
  return (
    <View style={{ paddingVertical: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <T v="strong" style={{ flex: 1 }}>{r.name}</T>
        <Badge label={STATE_TEXT[r.state]} tone={tone} />
        {r.ms ? <T v="small" c="faint">{(r.ms / 1000).toFixed(1)} с</T> : null}
      </View>
      <T v="small" c="muted">{explain(r)}</T>
    </View>
  );
}

function Snapshot({ s }: { s: SearchSnapshot }) {
  return (
    <Glass style={{ padding: 14, marginBottom: 10 }}>
      <T v="h3">«{s.q}»</T>
      <T v="small" c="faint">{GROUP_NAME[s.group]}. Варианты запроса: {s.variants.join(', ')}. Итог: {s.tracks.length} треков{s.loose.length ? `, ${s.loose.length} похожих названий` : ''}.</T>
      {s.runs.map((r) => <RunCard key={r.id} r={r} />)}
    </Glass>
  );
}

export default function Diagnostics() {
  const c = useColors();
  const [q, setQ] = useState('Моргенштерн');
  const [busy, setBusy] = useState(false);
  const live = useSearch();
  const log = useSearchLog((l) => l.items);
  const status = useQuery({
    queryKey: ['diagnostics-status'],
    queryFn: async () => Promise.all(PROVIDERS.map(async (p) => {
      const a = adapter(p.id);
      const st = a ? await a.status(ctx).catch(() => ({ state: 'needs_setup' as const, detail: 'Ошибка проверки' })) : null;
      return { p, a, st };
    })),
  });
  return (
    <Screen title="Диагностика источников" sub="Какие сервисы участвуют в поиске, что они ответили и почему песня могла не найтись.">
      <Section title="Подключение">
        {status.data?.map(({ p, a, st }) => a ? (
          <Row key={p.id} title={a.name} sub={`${GROUP_NAME[p.group]}. ${st?.detail ?? ''}`} onPress={() => router.push({ pathname: '/sources/[id]', params: { id: p.id } })}
            right={<Badge label={st?.state === 'ready' ? 'подключён' : 'нужна настройка'} tone={st?.state === 'ready' ? 'ok' : 'faint'} />} />
        ) : null)}
      </Section>

      <Section title="Проверить поиск" note="Запрос уйдёт во все подключённые источники сразу. Результаты появятся здесь и на вкладке «Поиск».">
        <Field testID="diag-query" value={q} onChangeText={setQ} placeholder="Например, Дэд Блонд" />
        <Btn testID="diag-run" label="Проверить" busy={busy} disabled={q.trim().length < 2} onPress={async () => { setBusy(true); await runSearch(q); setBusy(false); }} />
        {live.q && (!live.done || busy) ? <View style={{ marginTop: 12 }}><Snapshot s={live} /></View> : null}
      </Section>

      <Section title="Последние поиски">
        {log.length ? log.map((s) => <Snapshot key={`${s.group}${s.q}${s.startedAt}`} s={s} />) : <T c="muted">Пока пусто. Поищите что-нибудь на вкладке «Поиск» или нажмите «Проверить».</T>}
      </Section>
      <T v="small" c="faint" style={{ marginTop: 16, color: c.faint }}>Журнал хранится только в памяти и очищается при перезапуске приложения.</T>
    </Screen>
  );
}
