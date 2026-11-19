// Диагностика музыкальных источников: что подключено, кто ответил на поиск, сколько нашёл и почему нет.

import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Switch, View } from 'react-native';
import { sourceContext as ctx } from '@/platform/secureConfig';
import { runSearch, STATE_TEXT, useSearch, useSearchLog, type ProviderRun, type SearchSnapshot } from '@/search/engine';
import { abilities, ADAPTERS, INTEGRATION_LABEL, integrationOf, type IntegrationKind } from '@/sources/registry';
import { useSettings } from '@/state/settings';
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

const ORDER: IntegrationKind[] = ['user-import', 'own-server', 'authorized-download', 'authorized-stream', 'official-api', 'external-player', 'catalog', 'official-sdk', 'external-app'];
type Can = ReturnType<typeof abilities>;
/** Подписи возможностей. «Целиком» у YouTube — только в видимом плеере, «офлайн» у части источников — не для всех песен. */
function abilityBadges(can: Can): { key: string; label: string; ok: boolean; part?: boolean }[] {
  return [
    { key: 'search', label: `${can.search ? '✓' : '✕'} поиск`, ok: can.search },
    { key: 'full', label: can.full === 'visible' ? '✓ целиком в видимом плеере' : `${can.full ? '✓' : '✕'} целиком`, ok: !!can.full },
    { key: 'background', label: `${can.background ? '✓' : '✕'} в фоне`, ok: can.background },
    { key: 'offline', label: can.offline === 'some' ? 'офлайн только у части песен' : `${can.offline ? '✓' : '✕'} офлайн`, ok: can.offline === 'all', part: can.offline === 'some' },
  ];
}

/** Источник: включатель, состояние подключения и что он умеет в Камертоне. */
function SourceRow({ id, name, detail, ready, can, on, onToggle }: { id: string; name: string; detail?: string; ready: boolean; can: Can; on: boolean; onToggle: (v: boolean) => void }) {
  const c = useColors();
  return (
    <View style={{ paddingVertical: 9, opacity: on ? 1 : 0.55 }}>
      {/* Название и выключатель в одной строке, пояснение — на всю ширину ниже, чтобы текст не сжимался в узкую колонку. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <T v="strong" style={{ flex: 1 }} numberOfLines={1} onPress={() => router.push({ pathname: '/sources/[id]', params: { id } })}>{name}</T>
        <Switch testID={`toggle-${id}`} accessibilityLabel={`${name}: ${on ? 'включён' : 'выключен'}`} value={on} onValueChange={onToggle} trackColor={{ true: c.accent, false: c.line }} thumbColor={on ? c.onAccent : c.muted} />
      </View>
      {!on || detail ? <T v="small" c="muted" numberOfLines={2}>{on ? detail : 'Выключен: не ищет и не играет'}</T> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 6 }}>
        {on ? <Badge label={ready ? 'подключён' : 'нужна настройка'} tone={ready ? 'ok' : 'faint'} /> : null}
        {abilityBadges(can).map((b) => <Badge key={b.key} label={b.label} tone={b.ok ? 'ok' : b.part ? 'muted' : 'faint'} />)}
      </View>
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
  const disabled = useSettings((x) => x.disabledSources);
  const setS = useSettings((x) => x.set);
  const toggle = (id: string, on: boolean) => setS({ disabledSources: on ? disabled.filter((x) => x !== id) : [...new Set([...disabled, id])] });
  const status = useQuery({
    queryKey: ['diagnostics-status'],
    queryFn: async () => Promise.all(ADAPTERS.map(async (a) => ({ a, st: await a.status(ctx).catch(() => ({ state: 'needs_setup' as const, detail: 'Ошибка проверки' })) }))),
  });
  const groups = ORDER.map((k) => ({ k, items: (status.data ?? []).filter(({ a }) => integrationOf(a) === k) })).filter((g) => g.items.length);
  return (
    <Screen title="Диагностика источников" sub="Какие сервисы участвуют в поиске, что они ответили и почему песня могла не найтись.">
      <Section title="Источники" note="Выключенный источник не участвует в поиске, волне и воспроизведении. Нажмите на название, чтобы открыть настройки.">
        {groups.map((g) => (
          <Glass key={g.k} style={{ paddingHorizontal: 14, paddingVertical: 6, marginBottom: 10 }}>
            <T v="h3" style={{ marginTop: 6 }}>{INTEGRATION_LABEL[g.k]}</T>
            {g.items.map(({ a, st }) => <SourceRow key={a.id} id={a.id} name={a.name} detail={st.detail} ready={st.state === 'ready' || st.state === 'link_only'} can={abilities(a)} on={!disabled.includes(a.id)} onToggle={(v) => toggle(a.id, v)} />)}
          </Glass>
        ))}
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
