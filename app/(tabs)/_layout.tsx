import { router } from 'expo-router';
import { Tabs } from 'expo-router/tabs';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FONT, TAB_HEIGHT, useColors } from '@/ui/theme';

const LABELS: Record<string, string> = { index: 'Волна', search: 'Поиск', library: 'Коллекция', profile: 'Профиль' };
const HREF: Record<string, '/' | '/search' | '/library' | '/profile'> = { index: '/', search: '/search', library: '/library', profile: '/profile' };

// Нижняя панель без значков: крупные узкие слова работают как афиша и читаются сразу.
function TabBar({ state }: any) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: 'row', height: TAB_HEIGHT + insets.bottom, paddingBottom: insets.bottom, backgroundColor: c.bg, borderTopWidth: 1, borderTopColor: c.line, paddingHorizontal: 12 }}>
      {state.routes.map((r: any, i: number) => {
        const on = state.index === i;
        return (
          <Pressable key={r.key} testID={`tab-${r.name}`} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => { if (!on) router.navigate(HREF[r.name]); }}
            style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ position: 'absolute', top: -1, height: 3, width: 34, backgroundColor: on ? c.accent : 'transparent' }} />
            <Text allowFontScaling={false} style={{ fontFamily: on ? FONT.d8 : FONT.d6, fontSize: 26, color: on ? c.text : c.faint }}>{LABELS[r.name]}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function TabsLayout() {
  const c = useColors();
  return (
    <Tabs tabBar={(p) => <TabBar {...p} />} screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: c.bg } }}>
      <Tabs.Screen name="index" /><Tabs.Screen name="search" /><Tabs.Screen name="library" /><Tabs.Screen name="profile" />
    </Tabs>
  );
}
