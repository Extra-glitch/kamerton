import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { activeLine } from '@/core/lrc';
import { primaryArtist } from '@/core/text';
import { pickTextFile } from '@/platform/localMusic';
import { attachLyricsText, loadLyrics } from '@/services/media';
import { player, toast, usePlayer } from '@/state/app';
import { Btn, IconBtn, Loading, T } from '@/ui/kit';
import { Ambient } from '@/ui/ambient';
import { TYPE, useColors } from '@/ui/theme';

export default function LyricsScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const t = usePlayer((p) => p.current);
  const src = usePlayer((p) => p.source);
  const pos = usePlayer((p) => p.positionSec);
  const q = useQuery({ queryKey: ['lyrics', t?.id], queryFn: () => loadLyrics(t!, src), enabled: !!t });
  const scroll = useRef<any>(null);
  const offsets = useRef<number[]>([]);
  const [manualUntil, setManualUntil] = useState(0);
  const lyrics = q.data?.lyrics;
  const cur = lyrics?.synced ? activeLine(lyrics.lines, pos * 1000) : -1;
  useEffect(() => {
    if (cur < 0 || Date.now() < manualUntil) return;
    scroll.current?.scrollTo({ y: Math.max(0, (offsets.current[cur] ?? 0) - 170), animated: true });
  }, [cur, manualUntil]);
  const attach = async () => {
    try {
      const f = await pickTextFile(['text/*', 'application/octet-stream']);
      if (!f || !t) return;
      await attachLyricsText(t.id, f.text); await qc.invalidateQueries({ queryKey: ['lyrics', t.id] });
    } catch (e) { toast((e as Error).message); }
  };
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Ambient animate strength={0.9} />
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: insets.top + 4, paddingHorizontal: 8 }}>
        <IconBtn name="down" label="Закрыть текст" onPress={() => router.back()} />
        <View style={{ flex: 1 }}><T v="title" numberOfLines={1}>{t?.title}</T><T v="small" c="muted" numberOfLines={1}>{t?.artist}</T></View>
      </View>
      <ScrollView ref={scroll} onScrollBeginDrag={() => setManualUntil(Date.now() + 4000)} contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 200 }}>
        {q.isLoading ? <Loading /> : null}
        {lyrics?.lines.map((l, i) => {
          const on = i === cur;
          const body = <T style={[{ fontFamily: 'Body-700', fontSize: 24, lineHeight: 32 }, { color: on ? c.accent : lyrics.synced ? (i < cur ? c.faint : c.muted) : c.text, marginBottom: 12 }]}>{l.text || ' '}</T>;
          return lyrics.synced
            ? <Pressable key={i} accessibilityRole="button" onLayout={(e) => { offsets.current[i] = e.nativeEvent.layout.y; }} onPress={() => void player.seek((l.timeMs ?? 0) / 1000)}>{body}</Pressable>
            : <View key={i}>{body}</View>;
        })}
        {lyrics ? <T v="small" c="faint">Источник текста: {lyrics.origin}. {lyrics.synced ? 'Нажмите на строку, чтобы перейти к ней.' : 'Текст без привязки ко времени.'}</T> : null}
        {!q.isLoading && !lyrics && t ? <>
          <T v="h2">Текста нет</T>
          <T c="muted" style={{ marginVertical: 10 }}>Показываем только разрешённые источники: теги файла, ваш медиасервер или ваш .lrc-файл.</T>
          <Btn label="Добавить .lrc или текстовый файл" onPress={() => void attach()} />
          <Btn label="Найти на Genius" kind="line" icon="link" style={{ marginTop: 10 }} onPress={() => void Linking.openURL(`https://genius.com/search?q=${encodeURIComponent(`${primaryArtist(t.artist)} ${t.title}`)}`)} />
        </> : null}
      </ScrollView>
    </View>
  );
}
