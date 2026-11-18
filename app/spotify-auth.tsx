import { router } from 'expo-router';
import { useEffect } from 'react';
import { Loading, Screen } from '@/ui/kit';

// Сюда Android возвращает приложение после входа в Spotify. Код обрабатывает экран источника.
export default function SpotifyAuthReturn() {
  useEffect(() => { if (router.canGoBack()) router.back(); else router.replace('/sources/spotify'); }, []);
  return <Screen back={false}><Loading label="Завершаем вход" /></Screen>;
}
