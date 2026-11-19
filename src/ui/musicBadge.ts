import type { SourceTrack } from '@/core/types';
import { CATALOG_SOURCES, playMode, sourceName } from '@/sources/registry';

/** Песню можно попробовать найти целиком на YouTube: это песня из каталога, а не радио и не удалённая запись. */
export function canPlayViaYouTube(s: SourceTrack | null | undefined): boolean {
  if (!s || s.isLive || s.availability === 'gone') return false;
  if (s.source === 'youtube') return s.availability === 'full';
  return CATALOG_SOURCES.has(s.source) || playMode(s) === 'preview' || s.availability === 'external_only' || s.availability === 'subscription_required';
}

/** Как трек играет в Камертоне: короткая подпись для строки списка. */
export function playBadge(s: SourceTrack | null, youtubeReady = false): { label: string; tone: 'ok' | 'warn' | 'muted' | 'faint' } {
  if (!s) return { label: 'нет источника', tone: 'faint' };
  const m = playMode(s);
  if (m === 'player') return s.localPath ? { label: 'на телефоне', tone: 'ok' } : { label: 'целиком', tone: 'ok' };
  // С подключённым YouTube песня из каталога играет целиком: полная версия ищется при нажатии.
  if (youtubeReady && canPlayViaYouTube(s)) return { label: 'YouTube', tone: 'ok' };
  if (m === 'preview') return { label: 'фрагмент', tone: 'warn' };
  if (m === 'embed') return { label: s.source === 'youtube' ? 'YouTube' : sourceName(s.source), tone: 'ok' };
  if (s.availability === 'subscription_required') return { label: `${sourceName(s.source)}, подписка`, tone: 'muted' };
  if (s.availability === 'region_blocked') return { label: 'закрыто в регионе', tone: 'faint' };
  if (s.availability === 'gone') return { label: 'удалено', tone: 'faint' };
  return { label: `в ${sourceName(s.source)}`, tone: 'muted' };
}

