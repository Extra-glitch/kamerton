import { router } from 'expo-router';
import { Empty, Screen } from '@/ui/kit';

export default function NotFound() {
  return <Screen><Empty title="Такого экрана нет" text="Ссылка устарела или указана с ошибкой." action="На главную" onAction={() => router.replace('/')} /></Screen>;
}
