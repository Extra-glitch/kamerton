import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BlurTargetView } from 'expo-blur';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { boot } from '@/state/app';
import { Ambient, ArtworkTint } from '@/ui/ambient';
import { BlurTargetContext } from '@/ui/glass';
import { Btn, T } from '@/ui/kit';
import { Dock, OfflineBanner, Toast, TrackSheet } from '@/ui/music';
import { useColors } from '@/ui/theme';

void SplashScreen.preventAutoHideAsync().catch(() => undefined);
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 60_000, refetchOnWindowFocus: false } } });

export default function RootLayout() {
  const c = useColors();
  const target = useRef<ComponentRef<typeof View>>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fonts, fontError] = useFonts({
    'Display-700': require('@expo-google-fonts/unbounded/700Bold/Unbounded_700Bold.ttf'),
    'Display-500': require('@expo-google-fonts/unbounded/500Medium/Unbounded_500Medium.ttf'),
    'Body-400': require('@expo-google-fonts/golos-text/400Regular/GolosText_400Regular.ttf'),
    'Body-500': require('@expo-google-fonts/golos-text/500Medium/GolosText_500Medium.ttf'),
    'Body-700': require('@expo-google-fonts/golos-text/700Bold/GolosText_700Bold.ttf'),
  });
  const start = () => { setError(null); boot().then(() => setReady(true)).catch((e) => setError(String(e?.message ?? e))); };
  useEffect(start, []);
  const shown = (fonts || !!fontError) && (ready || !!error);
  useEffect(() => { if (shown) void SplashScreen.hideAsync().catch(() => undefined); }, [shown]);
  if (!shown) return <View style={{ flex: 1, backgroundColor: c.bg }} />;
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: c.bg }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <StatusBar style={c.blur === 'dark' ? 'light' : 'dark'} />
          {error ? (
            <View style={{ flex: 1, justifyContent: 'center', padding: 24 }}>
              <Ambient />
              <T v="h1">Библиотека не открылась</T>
              <T c="muted" style={{ marginVertical: 12 }}>{error}</T>
              <Btn label="Повторить" onPress={start} />
            </View>
          ) : (
            <BlurTargetContext.Provider value={target}>
              <ArtworkTint />
              {/* Всё, что под стеклянными панелями, лежит внутри «источника размытия». */}
              <BlurTargetView ref={target} style={{ flex: 1, backgroundColor: c.bg }}>
                <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg }, animation: 'fade_from_bottom' }}>
                  <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
                  <Stack.Screen name="player" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} />
                  <Stack.Screen name="queue" options={{ animation: 'slide_from_bottom' }} />
                  <Stack.Screen name="lyrics" options={{ presentation: 'fullScreenModal', animation: 'fade' }} />
                  <Stack.Screen name="embed" options={{ animation: 'slide_from_bottom' }} />
                </Stack>
              </BlurTargetView>
              <Dock />
              <OfflineBanner />
              <TrackSheet />
              <Toast />
            </BlurTargetContext.Provider>
          )}
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
