import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, View } from 'react-native';
import { friendlyError } from '@/net/http';
import { spotifyLogin } from '@/platform/oauth';
import { sourceContext as ctx } from '@/platform/secureConfig';
import { adapter, playbackLabel, STATE_LABEL } from '@/sources/registry';
import { refreshYouTubeReady } from '@/services/fullVersion';
import { bumpData, toast } from '@/state/app';
import { Btn, Field, Notice, Screen, T } from '@/ui/kit';

function Bullets({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return <View style={{ marginTop: 22 }}><T v="h3" style={{ marginBottom: 4 }}>{title}</T>{items.map((x) => <T key={x} c="muted" style={{ marginBottom: 6 }}>{x}</T>)}</View>;
}

export default function SourceDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const a = adapter(id);
  const [values, setValues] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const st = useQuery({ queryKey: ['source', id, result], queryFn: () => a!.status(ctx), enabled: !!a, staleTime: 0 });
  useEffect(() => { void ctx.getConfig(id).then(setValues); }, [id]);
  if (!a) return <Screen title="Источник не найден">{null}</Screen>;
  const cap = a.capabilities;
  const can = [cap.supportsSearch && 'поиск', cap.supportsDiscovery && 'рекомендации', cap.supportsPlaylistImport && 'импорт плейлистов', cap.supportsLibraryImport && 'импорт библиотеки', cap.canOffline && 'сохранение на телефон', cap.canBackground && 'фоновое воспроизведение', cap.supportsDeepLink && 'открытие в сервисе'].filter(Boolean).join(', ');
  const needs = [cap.requiresBackend && 'свой сервер', cap.requiresUserSubscription && 'подписка', cap.requiresOfficialApp && 'официальное приложение'].filter(Boolean).join(', ');
  const save = async () => { const clean: Record<string, string> = {}; for (const f of a.configFields ?? []) clean[f.key] = (values[f.key] ?? '').trim(); await ctx.setConfig(id, clean); };
  const check = async () => {
    setBusy(true); setResult(null);
    try { await save(); const text = a.verify ? await a.verify(ctx) : 'Сохранено.'; setResult({ ok: true, text }); bumpData(); void refreshYouTubeReady(); }
    catch (e) { setResult({ ok: false, text: friendlyError(e) }); } finally { setBusy(false); }
  };
  return (
    <Screen title={a.name}>
      <T>{a.doc.summary}</T>
      <T v="title" style={{ marginTop: 14 }}>{st.data ? STATE_LABEL[st.data.state] : ''}</T>
      <T v="small" c="muted">{playbackLabel(a)}{st.data?.detail ? `. ${st.data.detail}` : ''}</T>
      {can ? <T v="small" c="muted" style={{ marginTop: 4 }}>Доступно: {can}.</T> : null}
      {needs ? <T v="small" c="warn">Требуется: {needs}.</T> : null}
      {a.configFields ? <View style={{ marginTop: 20 }}>
        {a.configFields.map((f) => <Field key={f.key} label={f.label} hint={f.hint} placeholder={f.placeholder} secureTextEntry={f.secret} autoCapitalize="none" autoCorrect={false} value={values[f.key] ?? ''} onChangeText={(t) => setValues((v) => ({ ...v, [f.key]: t }))} />)}
        <T v="small" c="muted" style={{ marginBottom: 10 }}>Данные хранятся только в защищённом хранилище телефона.</T>
        {id === 'spotify' ? <Btn label="Войти в Spotify" busy={busy} onPress={async () => { setBusy(true); try { await save(); await spotifyLogin(ctx); setResult({ ok: true, text: await a.verify!(ctx) }); bumpData(); } catch (e) { setResult({ ok: false, text: friendlyError(e) }); } finally { setBusy(false); } }} /> : <Btn testID="source-check" label="Сохранить и проверить" busy={busy} onPress={() => void check()} />}
        <Btn label="Отключить и удалить данные" kind="quiet" onPress={async () => { await ctx.clearConfig(id); setValues({}); setResult(null); bumpData(); toast('Источник отключён'); }} style={{ alignSelf: 'flex-start', marginTop: 4 }} />
      </View> : a.verify ? <Btn label="Проверить соединение" kind="line" busy={busy} onPress={() => void check()} style={{ marginTop: 16 }} /> : null}
      {result ? <Notice tone={result.ok ? 'muted' : 'danger'} text={result.text} /> : null}
      {a.userPlaylists || a.likedTracks ? <Btn label="Импортировать из этого источника" kind="line" style={{ marginTop: 10 }} onPress={() => router.push({ pathname: '/import', params: { source: id } })} /> : null}
      <Bullets title="Как подключить" items={a.doc.setup} />
      <Bullets title="Ограничения" items={a.doc.limits} />
      <Bullets title="Не подтверждено" items={a.doc.unconfirmed} />
      {a.doc.docsUrl ? <Btn label="Документация сервиса" kind="quiet" icon="link" onPress={() => void Linking.openURL(a.doc.docsUrl!)} style={{ alignSelf: 'flex-start', marginTop: 12 }} /> : null}
    </Screen>
  );
}
