import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { boot } from '@/state/app';
import { Btn, T } from '@/ui/kit';
import { MiniPlayer, OfflineBanner, Toast, TrackSheet } from '@/ui/music';
import { useColors } from '@/ui/theme';

void SplashScreen.preventAutoHideAsync().catch(() => undefined);
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 60_000, refetchOnWindowFocus: false } } });

export default function RootLayout() {
  const c = useColors();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fonts, fontError] = useFonts({
    'Display-800': require('@expo-google-fonts/alumni-sans/800ExtraBold/AlumniSans_800ExtraBold.ttf'),
    'Display-600': require('@expo-google-fonts/alumni-sans/600SemiBold/AlumniSans_600SemiBold.ttf'),
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
          <StatusBar style={c.bg === '#0E211D' ? 'light' : 'dark'} />
          {error ? (
            <View style={{ flex: 1, justifyContent: 'center', padding: 24, backgroundColor: c.bg }}>
              <T v="h1">Библиотека не открылась</T>
              <T c="muted" style={{ marginVertical: 12 }}>{error}</T>
              <Btn label="Повторить" onPress={start} />
            </View>
          ) : (
            <>
              <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg }, animation: 'fade_from_bottom' }}>
                <Stack.Screen name="(tabs)" />
                <Stack.Screen name="player" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} />
                <Stack.Screen name="queue" options={{ animation: 'slide_from_bottom' }} />
                <Stack.Screen name="lyrics" options={{ presentation: 'fullScreenModal', animation: 'fade' }} />
              </Stack>
              <MiniPlayer />
              <OfflineBanner />
              <TrackSheet />
              <Toast />
            </>
          )}
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
