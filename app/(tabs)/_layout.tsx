import { Tabs } from 'expo-router/tabs';
import { useColors } from '@/ui/theme';

// Панель разделов рисуется в корне приложения (Dock в src/ui/music.tsx): так она лежит
// поверх «источника размытия» и становится настоящим стеклом.
export default function TabsLayout() {
  const c = useColors();
  return (
    <Tabs tabBar={() => null} screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: c.bg }, animation: 'fade' }}>
      <Tabs.Screen name="index" /><Tabs.Screen name="search" /><Tabs.Screen name="library" /><Tabs.Screen name="profile" />
    </Tabs>
  );
}
