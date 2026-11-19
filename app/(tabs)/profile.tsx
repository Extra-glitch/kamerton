import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as repo from '@/db/repo';
import { buildPortrait } from '@/reco/extras';
import { loadReco } from '@/services/reco';
import { useUi } from '@/state/app';
import { Row, T } from '@/ui/kit';
import { Ambient } from '@/ui/ambient';
import { BOTTOM_PAD, SPACE, useColors } from '@/ui/theme';

export default function Profile() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const version = useUi((u) => u.dataVersion + u.playVersion);
  const q = useQuery({ queryKey: ['profile', version], queryFn: async () => buildPortrait(await repo.getPlays(), (await loadReco()).tracks) });
  const p = q.data;
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
    <Ambient strength={0.75} />
    <ScrollView contentContainerStyle={{ paddingTop: insets.top + 14, paddingHorizontal: SPACE.page, paddingBottom: BOTTOM_PAD }}>
      <T v="h1" accessibilityRole="header">Профиль</T>
      <View style={{ flexDirection: 'row', gap: 26, marginVertical: 18 }}>
        <View><T v="h1">{p ? Math.round(p.hours) : 0}</T><T v="small" c="muted">часов музыки</T></View>
        <View><T v="h1">{p?.artists ?? 0}</T><T v="small" c="muted">исполнителей</T></View>
        <View><T v="h1">{p?.discoveries ?? 0}</T><T v="small" c="muted">открытий</T></View>
      </View>
      <Row icon="similar" testID="open-portrait" title="Музыкальный портрет" sub="Жанры, эпохи, исполнители и статистика" onPress={() => router.push('/portrait')} />
      <Row icon="heart" title="Общие лайки" sub="Сравните вкус с другом без регистрации" onPress={() => router.push('/shared')} />
      <Row icon="radio" testID="open-sources" title="Источники музыки" sub="Подключения, ключи и честные ограничения" onPress={() => router.push('/sources')} />
      <Row icon="plus" title="Импорт музыки" sub="Плейлисты текстом, файлом и ссылкой" onPress={() => router.push('/import')} />
      <Row icon="fork" title="Настройка вкуса" sub="Жанры, исполнители и степень открытий" onPress={() => router.push('/onboarding')} />
      <Row icon="timer" title="Новые релизы" sub="Любимые исполнители за последние месяцы" onPress={() => router.push('/releases')} />
      <Row icon="cover" testID="open-settings" title="Настройки" sub="Звук, тема, уведомления, данные" onPress={() => router.push('/settings')} />
      <Row icon="link" title="Что работает и что нет" sub="Ограничения и неподтверждённые возможности" onPress={() => router.push('/limits')} />
    </ScrollView>
    </View>
  );
}
