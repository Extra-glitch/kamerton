// Приём музыки через системное «Поделиться»: из Telegram, загрузок, файлового менеджера.
// Аудиофайлы добавляются в библиотеку, ссылки (YouTube, SoundCloud, Deezer) открываются в поиске.

import { router } from 'expo-router';
import { ShareIntentProvider, useShareIntentContext } from 'expo-share-intent';
import { useEffect, useRef, type ReactNode } from 'react';
import { AppState } from 'react-native';
import * as repo from '@/db/repo';
import { importNewDeviceFiles, importShared } from '@/services/importFiles';
import { bumpData, playTracks, toast } from '@/state/app';
import { settings } from '@/state/settings';

export function ShareRoot({ children }: { children: ReactNode }) {
  return <ShareIntentProvider options={{ resetOnBackground: true }}>{children}</ShareIntentProvider>;
}

const plural = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? 'песня' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'песни' : 'песен');

export function ShareReceiver() {
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();
  const busy = useRef(false);
  useEffect(() => {
    if (!hasShareIntent || busy.current) return;
    const files = (shareIntent.files ?? []).map((f) => ({ uri: f.path.startsWith('file://') ? f.path : `file://${f.path}`, name: f.fileName || 'audio.mp3', mime: f.mimeType }));
    const link = shareIntent.webUrl ?? (shareIntent.text?.match(/https?:\/\/\S+/)?.[0] ?? null);
    if (!files.length) {
      resetShareIntent();
      if (link) router.navigate({ pathname: '/search', params: { q: link } });
      return;
    }
    busy.current = true;
    toast(files.length > 1 ? `Добавляем ${files.length} файлов…` : 'Добавляем песню…');
    importShared(files).then(async (r) => {
      bumpData();
      if (!r.trackIds.length) { toast('Это не аудиофайл. Камертон принимает MP3, M4A, FLAC, OGG, OPUS и WAV.'); return; }
      const views = await repo.getViews(r.trackIds);
      // Одну присланную песню сразу включаем, несколько — просто добавляем в «На телефоне».
      if (views.length === 1) await playTracks(views, 0, 'import');
      toast(`Добавлено: ${r.trackIds.length} ${plural(r.trackIds.length)}${r.skipped.length ? `, пропущено ${r.skipped.length}` : ''}. Раздел «Коллекция → На телефоне».`);
    }).catch((e) => toast(`Не удалось добавить: ${(e as Error).message}`))
      .finally(() => { busy.current = false; resetShareIntent(); });
  }, [hasShareIntent, shareIntent, resetShareIntent]);

  // Новая музыка в памяти телефона (например, сохранённая из Telegram) добавляется сама.
  useEffect(() => {
    let last = 0;
    const check = () => {
      if (!settings().autoImport || Date.now() - last < 30_000) return;
      last = Date.now();
      importNewDeviceFiles().then((ids) => { if (ids.length) { bumpData(); toast(`Новая музыка с телефона: ${ids.length} ${plural(ids.length)}`); } }).catch(() => undefined);
    };
    check();
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') check(); });
    return () => sub.remove();
  }, []);
  return null;
}
