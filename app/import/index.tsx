import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, View } from 'react-native';
import type { RemoteTrack } from '@/core/types';
import { swapArtistTitle, type ImportItem } from '@/import/formats';
import { friendlyError } from '@/net/http';
import { pickAudioFiles, pickTextFile, scanDevice } from '@/platform/localMusic';
import { sourceContext as ctx } from '@/platform/secureConfig';
import { ADAPTERS, adapter } from '@/sources/registry';
import { importLog } from '@/services/importFiles';
import { BIG_IMPORT, importTargets, linkImport, parseImportFile, remoteToItems, runMatching } from '@/services/media';
import { bumpData, toast, useUi } from '@/state/app';
import { Glass } from '@/ui/glass';
import { Btn, Field, Notice, Press, Row, Screen, SwitchRow, T } from '@/ui/kit';
import { useSettings } from '@/state/settings';
import { Dial } from '@/ui/music';
import { useColors } from '@/ui/theme';

interface Pending { name: string; origin: string; items: ImportItem[]; rows: RemoteTrack[] }

/** Пошаговая инструкция: как вынести список из Яндекс Музыки, не отдавая никому пароль. */
function YandexHelp() {
  const c = useColors();
  const [open, setOpen] = useState(false);
  const steps: [string, string][] = [
    ['Скопировать список на компьютере', 'Откройте плейлист на music.yandex.ru в браузере компьютера и прокрутите его до конца, чтобы загрузились все песни. Выделите список мышью (от первой песни до последней), скопируйте и отправьте себе текстом, например в «Избранное» Telegram. Вставьте текст в поле ниже: Камертон сам разберёт название, исполнителя и длительность.'],
    ['Или заказать архив данных Яндекса', 'Зайдите на id.yandex.ru → «Управление данными» → «Данные на сервисах». Если в списке есть «Музыка», нажмите «Заказать архив». Когда архив придёт, распакуйте его и выберите здесь файл JSON или CSV через «Выбрать файл». Камертон найдёт в нём треки сам.'],
    ['Или через сервис переноса', 'Сайты вроде TuneMyMusic умеют выгружать плейлист Яндекса в файл CSV. Бесплатно обычно до 500 песен за раз, поэтому большой плейлист переносите частями. Пароль от Яндекса на сторонних сайтах лучше не вводить.'],
  ];
  return (
    <Glass style={{ padding: 16, marginTop: 18 }}>
      <Press accessibilityRole="button" onPress={() => setOpen(!open)} scaleTo={0.99}>
        <T v="h3">Перенести из Яндекс Музыки</T>
        <T v="small" c="muted" style={{ marginTop: 4 }}>{open ? 'Скрыть инструкцию' : 'Яндекс не даёт приложениям читать плейлисты по ссылке. Есть три честных способа: нажмите, чтобы открыть инструкцию.'}</T>
      </Press>
      {open ? <View style={{ marginTop: 10, gap: 12 }}>
        {steps.map(([title, text], i) => (
          <View key={title} style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' }}><T v="strong" c="accent">{i + 1}</T></View>
            <View style={{ flex: 1 }}><T v="strong">{title}</T><T v="small" c="muted" style={{ marginTop: 2 }}>{text}</T></View>
          </View>
        ))}
        <T v="small" c="faint">Ссылка вида music.yandex.ru/playlists/lk.… обычно ведёт на «Мне нравится». Для неё подходят все три способа.</T>
        <Btn label="Открыть id.yandex.ru" icon="link" kind="line" onPress={() => void Linking.openURL('https://id.yandex.ru/')} />
      </View> : null}
    </Glass>
  );
}

export default function ImportScreen() {
  const autoImport = useSettings((x) => x.autoImport);
  const setS = useSettings((x) => x.set);
  const p = useLocalSearchParams<{ source?: string }>();
  const [text, setText] = useState('');
  const [link, setLink] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const [progress, setProgress] = useState<{ d: number; t: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const targets = useQuery({ queryKey: ['import-targets', pending?.items.length ?? 0], queryFn: () => importTargets(pending?.items.length ?? 0) });
  const connected = useQuery({
    queryKey: ['import-connected'],
    queryFn: async () => {
      const out = [];
      for (const a of ADAPTERS.filter((x) => x.userPlaylists)) if ((await a.status(ctx)).state === 'ready') out.push({ a, lists: await a.userPlaylists!(ctx).catch(() => []) });
      return out;
    },
  });

  // Сначала показываем, как разобрался список: перепутанные столбцы видно сразу.
  const prepare = (name: string, origin: string, items: ImportItem[], rows: RemoteTrack[] = []) => {
    if (!items.length) { setError('Не удалось найти в данных ни одной песни. Проверьте, что в тексте есть названия, а не только ссылки.'); return; }
    setError(null); setPending({ name, origin, items, rows });
  };
  const start = async () => {
    if (!pending) return;
    setProgress({ d: 0, t: pending.items.length });
    try { await runMatching(pending.name, pending.origin, pending.items, (d, t) => setProgress({ d, t }), pending.rows); setPending(null); router.push('/import/review'); }
    catch (e) { setError(friendlyError(e)); } finally { setProgress(null); }
  };
  const guard = (fn: () => Promise<void>) => () => { fn().catch((e) => setError(friendlyError(e))); };
  const busy = !!progress;
  const big = (pending?.items.length ?? 0) > BIG_IMPORT;

  return (
    <Screen title="Импорт музыки" sub="Камертон находит те же песни в каталоге и источниках и показывает результат до создания плейлиста.">
      {error ? <Notice tone="danger" text={error} /> : null}

      {pending ? <Glass style={{ padding: 16 }}>
        <T v="h2">Проверьте список</T>
        <T v="small" c="muted" style={{ marginTop: 4 }}>Найдено песен: {pending.items.length}. Вот первые строки, как их понял Камертон:</T>
        <View style={{ marginVertical: 10, gap: 6 }}>
          {pending.items.slice(0, 6).map((i) => (
            <View key={i.position}><T v="title" numberOfLines={1}>{i.title}</T><T v="small" c="muted" numberOfLines={1}>{i.artist || 'исполнитель не указан'}{i.album ? `, ${i.album}` : ''}</T></View>
          ))}
        </View>
        <Btn label="Поменять местами название и исполнителя" kind="line" disabled={busy} onPress={() => setPending({ ...pending, items: swapArtistTitle(pending.items) })} />
        {targets.data ? <T v="small" c="faint" style={{ marginTop: 10 }}>Ищем в: {targets.data.map((a) => a.name).join(', ')}{big ? '. Для большого списка MusicBrainz и медленные архивы пропускаются, чтобы перенос занял пару минут.' : ''}</T> : null}
        {progress ? <View style={{ marginTop: 12 }}><T v="title">Сопоставляем: {progress.d} из {progress.t}</T><Dial label="Ход импорта" value={progress.d / progress.t} disabled /></View> : null}
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
          <Btn testID="import-start" label="Сопоставить" busy={busy} onPress={() => void start()} style={{ flex: 1 }} />
          <Btn label="Отмена" kind="line" disabled={busy} onPress={() => setPending(null)} />
        </View>
      </Glass> : <>
        <T v="h2" style={{ marginBottom: 8 }}>Вставить список</T>
        <Field testID="import-text" multiline placeholder={'Кино - Группа крови\nЗемфира - Искала\n\nили текст, скопированный со страницы плейлиста'} value={text} onChangeText={setText} style={{ minHeight: 120, textAlignVertical: 'top' }} hint="По одной песне в строке или целиком скопированная страница плейлиста из Яндекс Музыки, VK или Звука." />
        <Btn testID="import-text-go" label="Разобрать список" disabled={!text.trim()} onPress={() => prepare('Вставленный список', 'текст', parseImportFile('list.txt', text))} />

        <YandexHelp />

        <T v="h2" style={{ marginTop: 28, marginBottom: 2 }}>Файл плейлиста</T>
        <Row title="Выбрать файл" sub="CSV, JSON (в том числе архив данных Яндекса), M3U, M3U8, XSPF или TXT" icon="plus" onPress={guard(async () => { const f = await pickTextFile(); if (f) prepare(f.name.replace(/\.[^.]+$/, ''), 'файл', parseImportFile(f.name, f.text)); })} />

        <T v="h2" style={{ marginTop: 24, marginBottom: 8 }}>Ссылка</T>
        <Field placeholder="Ссылка на плейлист Deezer, Audius или Internet Archive" value={link} onChangeText={setLink} autoCapitalize="none" keyboardType="url" hint="Ещё работают ваши плейлисты Spotify после входа. Ссылки Яндекса и VK приложения читать не могут." />
        <Btn label="Загрузить по ссылке" kind="line" disabled={!link.trim()} onPress={guard(async () => { const r = await linkImport(link); prepare(r.title, 'ссылка', remoteToItems(r.tracks), r.tracks); })} />

        {connected.data?.length ? <><T v="h2" style={{ marginTop: 28, marginBottom: 2 }}>Подключённые сервисы</T>
          {connected.data.map(({ a, lists }) => <View key={a.id}>
            {a.likedTracks ? <Row title={`${a.name}: понравившееся`} icon="heart" onPress={guard(async () => { const t = await a.likedTracks!(ctx); prepare(`${a.name}: понравившееся`, a.name, remoteToItems(t), t); })} /> : null}
            {lists.map((l) => <Row key={l.id} title={l.title} sub={`${a.name}${l.trackCount ? `, треков: ${l.trackCount}` : ''}`} onPress={guard(async () => { const t = await adapter(a.id)!.playlistTracks!(ctx, l.id); prepare(l.title, a.name, remoteToItems(t), t); })} />)}
          </View>)}
        </> : <Row title="Подключить сервис" sub={p.source ? 'Сначала завершите вход в этом источнике' : 'Spotify или свой медиасервер'} icon="link" onPress={() => router.push('/sources')} />}

        <T v="h2" style={{ marginTop: 28, marginBottom: 2 }}>Свои файлы</T>
        <Row title="Найти музыку на телефоне" icon="search" onPress={guard(async () => { const n = await scanDevice(); bumpData(); toast(`Найдено файлов: ${n}`); })} />
        <Row title="Выбрать аудиофайлы" sub="Через файловый менеджер Android, в том числе из папки Telegram" icon="plus" onPress={guard(async () => { const n = await pickAudioFiles(); if (n) { bumpData(); toast(`Добавлено файлов: ${n}`); } })} />
        <Glass style={{ padding: 14, marginTop: 12 }}>
          <T v="h3">Из Telegram и других приложений</T>
          <T v="small" c="muted" style={{ marginTop: 4 }}>Откройте песню в Telegram, нажмите «⋮» → «Поделиться» → «Камертон». Песня добавится в коллекцию и сразу заиграет. Можно выбрать сразу несколько песен.</T>
          <T v="small" c="muted" style={{ marginTop: 6 }}>Telegram передаёт только сам файл: название и обложка, которые видны в чате, вместе с ним не приходят. Если в файле есть теги, Камертон возьмёт их. Если нет — предложит найти песню в каталоге, и название с обложкой подставятся.</T>
          <T v="small" c="muted" style={{ marginTop: 6 }}>«⋮» → «Сохранить в музыку» сохраняет файл под настоящим именем («Исполнитель - Название»): Камертон найдёт его сам при следующем открытии и возьмёт название из имени.</T>
        </Glass>
        <ImportLog />
        <SwitchRow title="Добавлять новую музыку с телефона" sub="Песни, сохранённые в память телефона, появятся в коллекции сами. Голосовые сообщения и записи не добавляются" value={autoImport} onChange={(v) => setS({ autoImport: v })} />
      </>}
    </Screen>
  );
}

const TITLE_FROM: Record<string, string> = { tags: 'название из тегов файла', file: 'название из имени файла', none: 'без названия', user: 'название указано вами' };
const COVER_FROM: Record<string, string> = { file: 'обложка из файла', catalog: 'обложка из каталога Deezer', kept: 'обложка прежняя', none: 'без обложки' };

/** Последние присланные и найденные файлы: что пришло и что из этого получилось. */
function ImportLog() {
  const v = useUi((u) => u.dataVersion);
  const q = useQuery({ queryKey: ['import-log', v], queryFn: importLog });
  if (!q.data?.length) return null;
  return (
    <View testID="import-log" style={{ marginTop: 16 }}>
      <T v="h3">Последние файлы</T>
      {q.data.slice(0, 8).map((e, i) => (
        <Row key={`${e.at}-${i}`} title={e.result === 'skipped' ? e.name : `${e.artist} — ${e.title}`}
          sub={e.result === 'skipped' ? `Не добавлен: ${e.reason}` : `${e.result === 'repeat' ? 'Уже был в коллекции' : `Добавлен (${e.from})`}: ${TITLE_FROM[e.titleFrom ?? 'file']}, ${COVER_FROM[e.coverFrom ?? 'none']}. Файл: ${e.name}${e.size ? `, ${(e.size / 1048576).toFixed(1)} МБ` : ''}`}
          icon={e.needsInfo ? 'search' : undefined}
          onPress={e.trackId ? () => router.push({ pathname: '/identify/[id]', params: { id: e.trackId! } }) : undefined} />
      ))}
    </View>
  );
}
