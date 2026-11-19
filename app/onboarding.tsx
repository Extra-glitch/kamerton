import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GENRES } from '@/core/genres';
import { useSettings } from '@/state/settings';
import { Btn, Chip, Field, T } from '@/ui/kit';
import { Dial } from '@/ui/music';
import { Ambient } from '@/ui/ambient';
import { useColors } from '@/ui/theme';

export default function Onboarding() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const s = useSettings();
  const [tags, setTags] = useState<string[]>(s.seedTags);
  const [artists, setArtists] = useState(s.seedArtists.join(', '));
  const [discovery, setDiscovery] = useState(s.discovery);
  const finish = () => {
    s.set({ onboarded: true, seedTags: tags, seedArtists: artists.split(',').map((a) => a.trim()).filter(Boolean), discovery });
    router.replace('/');
  };
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
    <Ambient animate />
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, paddingTop: insets.top + 24, paddingBottom: insets.bottom + 30 }}>
      <T v="poster" adjustsFontSizeToFit numberOfLines={1} style={{ marginLeft: -3 }}>Камертон</T>
      <T style={{ marginTop: 6, maxWidth: 440 }}>Настроим первый поток. Точным он станет не сразу: приложение учится на том, что вы слушаете, лайкаете и пропускаете.</T>
      <T v="h2" style={{ marginTop: 30, marginBottom: 12 }}>Что вам близко?</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {GENRES.map(([id, label]) => <Chip key={id} testID={`genre-${id}`} label={label} on={tags.includes(id)} onPress={() => setTags((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]))} />)}
      </View>
      <View style={{ height: 24 }} />
      <Field label="Любимые исполнители" placeholder="Через запятую" value={artists} onChangeText={setArtists} hint="Необязательно" />
      <T v="h2" style={{ marginTop: 10, marginBottom: 8 }}>Сколько нового слушать?</T>
      <Dial label="Сколько новой музыки" value={discovery} onCommit={setDiscovery} />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><T v="small" c="muted">Знакомое</T><T v="small" c="muted">Открытия</T></View>
      <Btn testID="onboarding-done" label="Начать слушать" onPress={finish} style={{ marginTop: 28 }} />
      <T v="small" c="muted" style={{ marginTop: 14 }}>Сразу работают Audius, Internet Archive, Radio Browser и файлы на телефоне. Jamendo и свой сервер подключаются в профиле.</T>
    </ScrollView>
    </View>
  );
}
