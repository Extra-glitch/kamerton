import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import type { RemoteTrack } from '@/core/types';
import type { ImportItem } from '@/import/formats';
import { friendlyError } from '@/net/http';
import { pickAudioFiles, pickTextFile, scanDevice } from '@/platform/localMusic';
import { sourceContext as ctx } from '@/platform/secureConfig';
import { ADAPTERS, adapter } from '@/sources/registry';
import { importTargets, linkImport, parseImportFile, remoteToItems, runMatching } from '@/services/media';
import { bumpData, toast } from '@/state/app';
import { Btn, Field, Notice, Row, Screen, T } from '@/ui/kit';
import { Dial } from '@/ui/music';

export default function ImportScreen() {
  const p = useLocalSearchParams<{ source?: string }>();
  const [text, setText] = useState('');
  const [link, setLink] = useState('');
  const [progress, setProgress] = useState<{ d: number; t: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const targets = useQuery({ queryKey: ['import-targets'], queryFn: importTargets });
  const connected = useQuery({
    queryKey: ['import-connected'],
    queryFn: async () => {
      const out = [];
      for (const a of ADAPTERS.filter((x) => x.userPlaylists)) if ((await a.status(ctx)).state === 'ready') out.push({ a, lists: await a.userPlaylists!(ctx).catch(() => []) });
      return out;
    },
  });

  const start = async (name: string, origin: string, items: ImportItem[], rows: RemoteTrack[] = []) => {
    if (!items.length) { setError('Не удалось найти в данных ни одной песни.'); return; }
    setError(null); setProgress({ d: 0, t: items.length });
    try { await runMatching(name, origin, items, (d, t) => setProgress({ d, t }), rows); router.push('/import/review'); }
    catch (e) { setError(friendlyError(e)); } finally { setProgress(null); }
  };
  const guard = (fn: () => Promise<void>) => () => { fn().catch((e) => setError(friendlyError(e))); };
  const busy = !!progress;

  return (
    <Screen title="Импорт музыки">
      <T c="muted" style={{ marginTop: -8 }}>Приложение находит те же песни в источниках, где они реально играют, и показывает результат до создания плейлиста.</T>
      {targets.data ? <T v="small" c="faint" style={{ marginTop: 6 }}>Ищем в: {targets.data.map((a) => a.name).join(', ')}</T> : null}
      {progress ? <View style={{ marginTop: 16 }}><T v="title">Сопоставляем: {progress.d} из {progress.t}</T><Dial label="Ход импорта" value={progress.d / progress.t} disabled /><T v="small" c="muted">MusicBrainz разрешает один запрос в секунду, поэтому большой список займёт несколько минут.</T></View> : null}
      {error ? <Notice tone="danger" text={error} /> : null}

      <T v="h2" style={{ marginTop: 26, marginBottom: 8 }}>Вставить список</T>
      <Field testID="import-text" multiline placeholder={'Кино - Группа крови\nЗемфира - Искала'} value={text} onChangeText={setText} style={{ minHeight: 110, textAlignVertical: 'top' }} hint="Подходит для Яндекс Музыки, VK и любого другого сервиса: по одной песне в строке." />
      <Btn testID="import-text-go" label="Сопоставить" disabled={!text.trim() || busy} onPress={() => void start('Вставленный список', 'текст', parseImportFile('list.txt', text))} />

      <T v="h2" style={{ marginTop: 30, marginBottom: 2 }}>Файл плейлиста</T>
      <Row title="Выбрать файл" sub="CSV, JSON, M3U, M3U8, XSPF или TXT" icon="plus" onPress={busy ? undefined : guard(async () => { const f = await pickTextFile(); if (f) await start(f.name.replace(/\.[^.]+$/, ''), 'файл', parseImportFile(f.name, f.text)); })} />

      <T v="h2" style={{ marginTop: 26, marginBottom: 8 }}>Ссылка</T>
      <Field placeholder="https://audius.co/… или archive.org/details/…" value={link} onChangeText={setLink} autoCapitalize="none" keyboardType="url" hint="Работают Audius, Internet Archive и ваши плейлисты Spotify после входа." />
      <Btn label="Загрузить по ссылке" kind="line" disabled={!link.trim() || busy} onPress={guard(async () => { const r = await linkImport(link); await start(r.title, 'ссылка', remoteToItems(r.tracks), r.tracks); })} />

      {connected.data?.length ? <><T v="h2" style={{ marginTop: 30, marginBottom: 2 }}>Подключённые сервисы</T>
        {connected.data.map(({ a, lists }) => <View key={a.id}>
          {a.likedTracks ? <Row title={`${a.name}: понравившееся`} icon="heart" onPress={busy ? undefined : guard(async () => { const t = await a.likedTracks!(ctx); await start(`${a.name}: понравившееся`, a.name, remoteToItems(t), t); })} /> : null}
          {lists.map((l) => <Row key={l.id} title={l.title} sub={`${a.name}${l.trackCount ? `, треков: ${l.trackCount}` : ''}`} onPress={busy ? undefined : guard(async () => { const t = await adapter(a.id)!.playlistTracks!(ctx, l.id); await start(l.title, a.name, remoteToItems(t), t); })} />)}
        </View>)}
      </> : <Row title="Подключить сервис" sub={p.source ? 'Сначала завершите вход в этом источнике' : 'Spotify или свой медиасервер'} icon="link" onPress={() => router.push('/sources')} />}

      <T v="h2" style={{ marginTop: 30, marginBottom: 2 }}>Свои файлы</T>
      <Row title="Найти музыку на телефоне" icon="search" onPress={guard(async () => { const n = await scanDevice(); bumpData(); toast(`Найдено файлов: ${n}`); })} />
      <Row title="Выбрать аудиофайлы" icon="plus" onPress={guard(async () => { const n = await pickAudioFiles(); if (n) { bumpData(); toast(`Добавлено файлов: ${n}`); } })} />
    </Screen>
  );
}
