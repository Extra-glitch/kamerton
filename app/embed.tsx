// Официальный встраиваемый плеер YouTube или SoundCloud. Он должен быть виден на экране:
// так требуют правила этих сервисов. При сворачивании приложения плеер выгружается.

import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { AppState, Linking, Platform, useWindowDimensions, View } from 'react-native';
import WebView from 'react-native-webview';
import * as repo from '@/db/repo';
import { applyFeedback } from '@/services/reco';
import { soundCloudEmbedUrl } from '@/sources/soundcloud';
import { sourceName } from '@/sources/registry';
import { bumpData, openSheet, player, toast } from '@/state/app';
import { Glass } from '@/ui/glass';
import { Btn, Empty, Loading, Notice, Screen, T } from '@/ui/kit';
import { useColors } from '@/ui/theme';

type Embed = { provider: 'youtube'; id: string } | { provider: 'soundcloud'; url: string };

function html(e: Embed) {
  const src = e.provider === 'youtube'
    ? `https://www.youtube-nocookie.com/embed/${e.id}?autoplay=1&playsinline=1&rel=0`
    : soundCloudEmbedUrl(e.url);
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="strict-origin-when-cross-origin"><style>html,body{margin:0;height:100%;background:#000}iframe{border:0;width:100%;height:100%}</style></head><body><iframe src="${src.replace(/"/g, '&quot;')}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></body></html>`;
}

export default function EmbedScreen() {
  const c = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { width } = useWindowDimensions();
  const [active, setActive] = useState(AppState.currentState === 'active');
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const q = useQuery({ queryKey: ['embed', id], queryFn: async () => (await repo.getViews([id]))[0] ?? null });
  // У встроенного плеера свой звук: плеер Камертона на это время замолкает.
  useEffect(() => { player.pause(); }, []);
  useEffect(() => { const sub = AppState.addEventListener('change', (st) => setActive(st === 'active')); return () => sub.remove(); }, []);
  const t = q.data;
  const src = t?.sources.find((s) => (s.extra as { embed?: Embed } | undefined)?.embed);
  const embed = (src?.extra as { embed?: Embed } | undefined)?.embed;
  const w = Math.min(width - 36, 640);
  const h = embed?.provider === 'youtube' ? (w * 9) / 16 : (src?.extra as { isSet?: boolean } | undefined)?.isSet ? 460 : 380;
  if (q.isLoading) return <Screen><Loading /></Screen>;
  if (!t || !embed || !src) return <Screen title="Плеер"><Empty title="Нечего показать" text="У этой записи нет встроенного плеера." /></Screen>;
  return (
    <Screen>
      <T v="h1" numberOfLines={2}>{t.title}</T>
      <T c="muted" style={{ marginBottom: 14 }}>{t.artist}, плеер {sourceName(src.source)}</T>
      <Glass radius={20} style={{ width: w, height: h, alignSelf: 'center', backgroundColor: '#000' }}>
        {Platform.OS === 'web' ? <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 }}><T c="muted" style={{ textAlign: 'center' }}>Встроенный плеер работает в приложении на телефоне.</T></View>
          : active ? <WebView key={attempt} source={{ html: html(embed), baseUrl: 'https://kamerton.app' }} style={{ backgroundColor: '#000' }} allowsFullscreenVideo allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false} onError={() => setFailed(true)} onHttpError={() => setFailed(true)} setSupportMultipleWindows={false}
            onShouldStartLoadWithRequest={(r) => { if (r.isTopFrame && !r.url.startsWith('about:') && !r.url.startsWith('https://kamerton.app')) { void Linking.openURL(r.url); return false; } return true; }} />
            : <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><T c="muted">Плеер остановлен, пока приложение было свёрнуто</T></View>}
      </Glass>
      {failed ? <Notice tone="danger" text="Плеер не загрузился. Проверьте интернет и VPN." /> : null}
      {embed.provider === 'soundcloud' ? <Notice text="Если плеер предлагает «Play on SoundCloud», нажмите «Listen in browser»: запись заиграет прямо здесь." /> : null}
      <Notice title="В России нужен VPN" text={`${sourceName(src.source)} заблокирован. Если плеер остаётся пустым или бесконечно загружается, включите свой VPN и нажмите «Обновить». Скачать запись отсюда нельзя: это запрещают правила сервиса.`} />
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 6 }}>
        <Btn label="Обновить" kind="line" onPress={() => { setFailed(false); setAttempt((n) => n + 1); }} style={{ flex: 1 }} />
        <Btn label={t.liked ? 'В любимом' : 'В любимое'} icon={t.liked ? 'heartOn' : 'heart'} kind="line" onPress={async () => { await applyFeedback(t.id, 'like', !t.liked); bumpData(); void q.refetch(); toast(t.liked ? 'Убрано из любимого' : 'Добавлено в любимое'); }} style={{ flex: 1 }} />
      </View>
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
        {src.externalUrl ? <Btn label={`Открыть в ${sourceName(src.source)}`} icon="link" kind="line" onPress={() => void Linking.openURL(src.externalUrl!)} style={{ flex: 1 }} /> : null}
        <Btn label="Ещё" icon="more" kind="line" onPress={() => openSheet(t)} style={{ flex: 1 }} />
      </View>
      <T v="small" c="faint" style={{ marginTop: 12, color: c.faint }}>Звук идёт из плеера {sourceName(src.source)}: он не работает в фоне и на экране блокировки.</T>
    </Screen>
  );
}
