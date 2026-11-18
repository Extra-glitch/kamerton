import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

const ID = 'daily-discoveries';

/** Локальное ежедневное напоминание. Сервер и push-токены не используются. */
export async function setDailyReminder(on: boolean): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  await Notifications.cancelScheduledNotificationAsync(ID).catch(() => undefined);
  if (!on) return false;
  const perm = await Notifications.requestPermissionsAsync();
  if (!perm.granted) return false;
  await Notifications.setNotificationChannelAsync('daily', { name: 'Открытия дня', importance: Notifications.AndroidImportance.DEFAULT });
  await Notifications.scheduleNotificationAsync({
    identifier: ID,
    content: { title: 'Открытия дня готовы', body: 'Несколько треков, которых вы ещё не слышали.' },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: 11, minute: 0, channelId: 'daily' },
  });
  return true;
}
