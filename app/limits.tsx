import { View } from 'react-native';
import { ADAPTERS } from '@/sources/registry';
import { Screen, T } from '@/ui/kit';

const APP_LIMITS = [
  'Переход между треками сделан плавным затуханием. Настоящее наложение двух треков пока не реализовано.',
  'Рекомендации учатся постепенно и работают по метаданным и вашей истории. Звук треков каталога не анализируется.',
  'Яндекс Музыка, VK Музыка и Spotify не играют внутри приложения: сервисы этого не разрешают.',
  'Если источник не сообщает о цензуре, приложение пишет «версия не указана», а не называет трек оригиналом.',
  'Клипы показываются только в видимом плеере YouTube и не играют в фоне.',
  'Тексты берутся только из тегов файлов, вашего сервера и ваших .lrc-файлов. LRCLIB выключен по умолчанию: это база пользователей с неясными правами.',
];

export default function Limits() {
  return (
    <Screen title="Что работает и что нет">
      {APP_LIMITS.map((x) => <T key={x} style={{ marginBottom: 12 }}>{x}</T>)}
      <T v="h2" style={{ marginTop: 18, marginBottom: 8 }}>Не подтверждено</T>
      {ADAPTERS.filter((a) => a.doc.unconfirmed.length).map((a) => <View key={a.id} style={{ marginBottom: 12 }}><T v="title">{a.name}</T>{a.doc.unconfirmed.map((u) => <T key={u} v="small" c="muted">{u}</T>)}</View>)}
    </Screen>
  );
}
