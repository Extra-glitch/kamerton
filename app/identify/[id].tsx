// «Что это за песня?»: файл пришёл без названия и обложки (так бывает с «Поделиться» из Telegram),
// пользователь находит песню в каталоге или вписывает название сам.

import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import * as repo from '@/db/repo';
import { applyIdentity, identifyCandidates } from '@/services/importFiles';
import { bumpData, player, toast } from '@/state/app';
import { Badge, Btn, Cover, Field, Loading, Notice, Screen, T } from '@/ui/kit';
import { useColors } from '@/ui/theme';

const mmss = (sec?: number) => (sec ? `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}` : '');

export default function Identify() {
  const c = useColors();
  const { id, from } = useLocalSearchParams<{ id: string; from?: string }>();
  const view = useQuery({ queryKey: ['identify-view', id], queryFn: () => repo.getView(id) });
  const t = view.data;
  const local = t?.sources.find((s) => s.source === 'local');
  const known = local?.extra?.titleFrom && local.extra.titleFrom !== 'none';
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!t) return;
    const start = known ? `${t.artist === 'Неизвестный исполнитель' ? '' : t.artist} ${t.title}`.trim() : '';
    setText(start); setQ(start);
    if (known) { setTitle(t.title); setArtist(t.artist === 'Неизвестный исполнитель' ? '' : t.artist); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t?.id]);
  useEffect(() => { const h = setTimeout(() => setQ(text.trim()), 450); return () => clearTimeout(h); }, [text]);

  const found = useQuery({ queryKey: ['identify', q, t?.durationSec], queryFn: () => identifyCandidates(q, t?.durationSec), enabled: q.length >= 2 });

  const apply = async (v: { title: string; artist: string; album?: string; coverUrl?: string; isrc?: string }) => {
    if (!v.title.trim()) { toast('Впишите название песни'); return; }
    setBusy(true);
    try {
      await applyIdentity(id, v);
      bumpData(); player.invalidate(id);
      toast(v.coverUrl ? 'Название и обложка подставлены' : 'Название сохранено');
      router.back();
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };

  if (!t) return <Screen title="Что это за песня?"><Loading /></Screen>;
  const fileName = String(local?.extra?.fileName ?? '');
  return (
    <Screen title="Что это за песня?">
      {from === 'share' && !known ? (
        <Notice tone="warn" text="Telegram передал только сам файл. Название, исполнитель и обложка из чата вместе с ним не приходят, а в файле их нет. Найдите песню — Камертон подставит название и обложку. Песня уже в библиотеке и играет." />
      ) : (
        <T c="muted" style={{ marginTop: -8 }}>Найдите песню в каталоге или впишите название сами. Сам файл не меняется.</T>
      )}
      <T v="small" c="faint" style={{ marginTop: 6 }}>Файл: {fileName || 'без имени'}{t.durationSec ? `, ${mmss(t.durationSec)}` : ''}</T>

      <Field testID="identify-search" label="Исполнитель и название" placeholder="Например: Земфира Искала" value={text} onChangeText={setText} autoCorrect={false} style={{ marginTop: 14 }} />
      {found.isFetching ? <Loading label="Ищем в каталогах" /> : null}
      {found.data && !found.data.length && !found.isFetching ? <T v="small" c="muted">Ничего не нашлось. Попробуйте иначе или впишите название ниже.</T> : null}
      {found.data?.slice(0, 12).map((cand, i) => (
        <Pressable key={`${cand.track.source}:${cand.track.sourceTrackId}`} testID={`identify-result-${i}`} accessibilityRole="button" disabled={busy}
          accessibilityLabel={`${cand.track.artist} — ${cand.track.title}`}
          onPress={() => void apply({ title: cand.track.title, artist: cand.track.artist, album: cand.track.album, coverUrl: cand.track.coverUrl, isrc: cand.track.isrc })}
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, opacity: pressed ? 0.6 : 1 })}>
          <Cover uri={cand.track.coverUrl} title={cand.track.artist} size={48} radius={10} />
          <View style={{ flex: 1 }}>
            <T v="strong" numberOfLines={1}>{cand.track.title}</T>
            <T v="small" c="muted" numberOfLines={1}>{cand.track.artist}{cand.track.album ? `, ${cand.track.album}` : ''}</T>
            <View style={{ flexDirection: 'row', gap: 6, marginTop: 3 }}>
              {cand.durationMatch ? <Badge label="совпадает по длительности" tone="ok" /> : cand.track.durationSec ? <T v="small" c="faint">{mmss(cand.track.durationSec)}</T> : null}
            </View>
          </View>
        </Pressable>
      ))}

      <View style={{ marginTop: 22, borderTopWidth: 1, borderTopColor: c.line, paddingTop: 16 }}>
        <T v="h3">Вписать вручную</T>
        <Field testID="identify-title" label="Название" placeholder="Название песни" value={title} onChangeText={setTitle} />
        <Field testID="identify-artist" label="Исполнитель" placeholder="Кто исполняет" value={artist} onChangeText={setArtist} />
        <Btn testID="identify-save" label="Сохранить название" busy={busy} onPress={() => void apply({ title, artist })} />
        <Btn label="Оставить как есть" kind="quiet" onPress={() => router.back()} style={{ alignSelf: 'flex-start', marginTop: 6 }} />
      </View>
    </Screen>
  );
}
