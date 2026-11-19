import * as Sharing from 'expo-sharing';
import { router } from 'expo-router';
import { Alert, Platform, Share, View } from 'react-native';
import * as repo from '@/db/repo';
import { writeExportFile } from '@/platform/localMusic';
import { setDailyReminder } from '@/platform/notify';
import { sourceContext } from '@/platform/secureConfig';
import { ADAPTERS } from '@/sources/registry';
import type { QualityPreference } from '@/sources/types';
import { bumpData, player, toast } from '@/state/app';
import { useSettings } from '@/state/settings';
import { Choice, Row, Screen, SwitchRow, T } from '@/ui/kit';

const QUALITY: { value: QualityPreference; label: string }[] = [{ value: 'data_saver', label: 'Экономия' }, { value: 'normal', label: 'Обычное' }, { value: 'high', label: 'Высокое' }, { value: 'lossless', label: 'Максимальное' }];
const H = ({ children }: { children: string }) => <T v="h2" style={{ marginTop: 28, marginBottom: 8 }}>{children}</T>;

export default function Settings() {
  const s = useSettings();
  const exportData = async () => {
    const text = JSON.stringify(await repo.exportUserData(), null, 2);
    if (Platform.OS === 'web') await Share.share({ message: text });
    else await Sharing.shareAsync(writeExportFile('kamerton-data.json', text));
  };
  return (
    <Screen title="Настройки">
      <H>Оформление</H>
      <Choice value={s.theme} onChange={(theme) => s.set({ theme })} options={[{ value: 'system', label: 'Как в системе' }, { value: 'dark', label: 'Тёмная' }, { value: 'light', label: 'Светлая' }]} />

      <H>Качество звука</H>
      <T v="strong" style={{ marginBottom: 6 }}>Wi-Fi</T>
      <Choice value={s.qualityWifi} onChange={(qualityWifi) => s.set({ qualityWifi })} options={QUALITY} />
      <T v="strong" style={{ marginTop: 14, marginBottom: 6 }}>Мобильный интернет</T>
      <Choice value={s.qualityCell} onChange={(qualityCell) => s.set({ qualityCell })} options={QUALITY} />
      <T v="small" c="muted" style={{ marginTop: 8 }}>Применяется там, где источник предлагает выбор. Без потерь доступно для ваших файлов, своего сервера и записей архива с FLAC.</T>
      <SwitchRow title="Плавные переходы" sub="Затухание в конце трека и нарастание в начале" value={s.fade} onChange={(fade) => { s.set({ fade }); player.setFade(fade); }} />

      <H>Версии песен</H>
      <Choice value={s.versionFilter} onChange={(versionFilter) => { s.set({ versionFilter }); bumpData(); }} options={[{ value: 'original_first', label: 'Сначала оригинал' }, { value: 'all', label: 'Без предпочтений' }, { value: 'clean_only', label: 'Сначала без мата' }]} />
      <T v="small" c="muted" style={{ marginTop: 8 }}>Композиции с пометкой Explicit не скрываются. Цензурированная версия не подставляется вместо оригинала.</T>
      <SwitchRow title="Только то, что можно слушать" sub="В поиске не показывать фрагменты и песни, которые играют только в других приложениях" value={s.fullOnly} onChange={(fullOnly) => s.set({ fullOnly })} />
      <Row title="Диагностика музыкальных источников" sub="Какие сервисы подключены и что они отвечают на поиск" onPress={() => router.push('/diagnostics')} />
      <SwitchRow title="Цвета обложки" sub="Фон и акцент приложения подстраиваются под играющий трек" value={s.coverColors} onChange={(coverColors) => s.set({ coverColors })} />
      <SwitchRow title="Анимации" sub="Плавный фон и пульсация кнопки. Если в системе включено «Уменьшить движение», они отключаются сами" value={s.animations} onChange={(animations) => s.set({ animations })} />

      <H>Рекомендации и данные</H>
      <SwitchRow title="Записывать историю" sub="Без неё рекомендации перестают учиться" value={s.recordHistory} onChange={(recordHistory) => s.set({ recordHistory })} />
      <SwitchRow title="MusicBrainz" sub="ISRC, жанры и релизы. На сервис уходят названия песен" value={s.musicBrainzEnabled} onChange={(musicBrainzEnabled) => s.set({ musicBrainzEnabled })} />
      <SwitchRow title="ListenBrainz" sub="Родственные исполнители. На сервис уходит идентификатор исполнителя" value={s.listenBrainzEnabled} onChange={(listenBrainzEnabled) => s.set({ listenBrainzEnabled })} />

      <H>Тексты и видео</H>
      <SwitchRow title="Клипы" sub="Отключите для экономии трафика" value={s.videoEnabled} onChange={(videoEnabled) => s.set({ videoEnabled })} />
      <SwitchRow title="LRCLIB" sub="Тексты из базы пользователей. Законность показа каждого текста не гарантирована" value={s.lrclibEnabled} onChange={(lrclibEnabled) => s.set({ lrclibEnabled })} />

      <H>Уведомления</H>
      <SwitchRow title="Открытия дня" sub="Напоминание в 11:00, без сервера" value={s.dailyNotification} onChange={async (on) => { const ok = await setDailyReminder(on).catch(() => false); s.set({ dailyNotification: on && ok }); if (on && !ok) toast('Уведомления не разрешены'); }} />

      <H>Конфиденциальность</H>
      <T v="small" c="muted">Библиотека и история хранятся только на телефоне. Сервера Камертона нет.</T>
      <View style={{ height: 6 }} />
      <Row icon="share" title="Экспортировать мои данные" onPress={() => void exportData().catch((e) => toast(e.message))} />
      <Row icon="timer" title="Очистить историю" onPress={() => Alert.alert('Очистить историю?', 'Рекомендации начнут учиться заново.', [{ text: 'Отмена' }, { text: 'Очистить', style: 'destructive', onPress: () => { void repo.clearHistory().then(bumpData); } }])} />
      <Row icon="trash" danger title="Удалить все данные" sub="Библиотека, история, плейлисты и ключи источников" onPress={() => Alert.alert('Удалить всё?', 'Это действие нельзя отменить.', [{ text: 'Отмена' }, { text: 'Удалить', style: 'destructive', onPress: async () => { await repo.deleteAllData(); await Promise.all(ADAPTERS.map((a) => sourceContext.clearConfig(a.id))); await s.load(); bumpData(); router.replace('/onboarding'); } }])} />
    </Screen>
  );
}
