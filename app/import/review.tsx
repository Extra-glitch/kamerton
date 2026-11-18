import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { formatDuration } from '@/core/text';
import type { ImportRow } from '@/import/pipeline';
import { summarize } from '@/import/pipeline';
import { getImportDraft, savePlaylistFromDraft } from '@/services/media';
import { sourceName } from '@/sources/registry';
import { bumpData, toast } from '@/state/app';
import { Btn, Chip, Empty, Field, IconBtn, Notice, Screen, s as ks, T } from '@/ui/kit';
import { useColors } from '@/ui/theme';

type Filter = 'all' | 'matched' | 'doubtful' | 'missing';
const STATUS: Record<ImportRow['status'], string> = { matched: 'Найдено', doubtful: 'Сомнительно', clean_only: 'Только цензурированная версия', other_version: 'Другая версия', missing: 'Не найдено' };
const group = (r: ImportRow): Filter => (r.status === 'matched' ? 'matched' : r.status === 'missing' ? 'missing' : 'doubtful');

export default function Review() {
  const c = useColors();
  const draft = getImportDraft();
  const [rows, setRows] = useState<ImportRow[]>(draft?.rows ?? []);
  const [filter, setFilter] = useState<Filter>('all');
  const [name, setName] = useState(draft?.name ?? 'Импорт');
  const [saving, setSaving] = useState(false);
  const s = useMemo(() => summarize(rows), [rows]);
  if (!draft) return <Screen title="Проверка"><Empty title="Нет данных" text="Начните импорт заново." action="К импорту" onAction={() => router.replace('/import')} /></Screen>;
  const update = (i: number, patch: Partial<ImportRow>) => setRows((all) => all.map((r) => (r.item.position === i ? { ...r, ...patch } : r)));
  const accepted = rows.filter((r) => r.best && r.decision !== 'reject' && (r.status === 'matched' || r.decision === 'accept')).length;
  return (
    <Screen title="Проверка">
      <View style={{ flexDirection: 'row', gap: 24 }}>
        <View><T v="h1">{s.matched}</T><T v="small" c="muted">найдено</T></View>
        <View><T v="h1" c="warn">{s.doubtful}</T><T v="small" c="muted">сомнительно</T></View>
        <View><T v="h1" c="danger">{s.missing}</T><T v="small" c="muted">нет</T></View>
      </View>
      <Notice text="Сомнительные песни не добавляются сами: подтвердите их или выберите другой вариант. Ненайденные останутся в плейлисте на своих местах." />
      <View style={[ks.wrap, { marginBottom: 12 }]}>
        {([['all', 'Все'], ['matched', 'Найдено'], ['doubtful', 'Сомнительно'], ['missing', 'Не найдено']] as [Filter, string][]).map(([f, l]) => <Chip key={f} label={l} on={filter === f} onPress={() => setFilter(f)} />)}
      </View>
      {rows.filter((r) => filter === 'all' || group(r) === filter).map((r) => {
        const ok = r.best && r.decision !== 'reject' && (r.status === 'matched' || r.decision === 'accept');
        return (
          <View key={r.item.position} style={{ paddingVertical: 10, borderTopWidth: 1, borderTopColor: c.line }}>
            <T v="title">{r.item.artist ? `${r.item.artist} — ` : ''}{r.item.title}</T>
            <T v="small" c={r.status === 'matched' ? 'muted' : r.status === 'missing' ? 'danger' : 'warn'}>{STATUS[r.status]}{r.notes.length ? `: ${r.notes.join('; ')}` : ''}</T>
            {r.best ? <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 3 }}>
              <View style={{ flex: 1 }}><T v="strong" numberOfLines={1}>{r.best.artist}: {r.best.title}</T><T v="small" c="faint">{sourceName(r.best.source)}{r.best.durationSec ? `, ${formatDuration(r.best.durationSec)}` : ''}, совпадение {Math.round(r.score * 100)}%</T></View>
              <IconBtn name="check" label="Принять" active={!!ok} onPress={() => update(r.item.position, { decision: 'accept' })} />
              <IconBtn name="close" label="Отклонить" active={r.decision === 'reject'} onPress={() => update(r.item.position, { decision: 'reject' })} />
            </View> : null}
            {r.alternatives.slice(0, 3).map((a) => (
              <Pressable key={`${a.candidate.source}${a.candidate.sourceTrackId}`} accessibilityRole="button" onPress={() => update(r.item.position, { best: a.candidate, score: a.score, status: a.status === 'missing' ? 'doubtful' : a.status, notes: a.notes, decision: 'accept' })} style={{ paddingVertical: 4 }}>
                <T v="small" c="muted" numberOfLines={1}>Вариант: {a.candidate.artist}: {a.candidate.title}, {sourceName(a.candidate.source)}</T>
              </Pressable>
            ))}
          </View>
        );
      })}
      <View style={{ marginTop: 22 }}>
        <Field label="Название плейлиста" value={name} onChangeText={setName} />
        <Btn testID="import-save" label={`Создать плейлист: ${accepted} из ${rows.length} можно слушать`} busy={saving} disabled={!name.trim()} onPress={async () => {
          setSaving(true);
          try { const id = await savePlaylistFromDraft({ ...draft, rows }, name.trim()); bumpData(); toast('Плейлист создан'); router.replace({ pathname: '/playlist/[id]', params: { id } }); }
          catch (e) { toast((e as Error).message); setSaving(false); }
        }} />
      </View>
    </Screen>
  );
}
