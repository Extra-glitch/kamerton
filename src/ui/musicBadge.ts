import type { SourceTrack } from '@/core/types';
import { playMode, sourceName } from '@/sources/registry';

/** Как трек играет в Камертоне: короткая подпись для строки списка. */
export function playBadge(s: SourceTrack | null): { label: string; tone: 'ok' | 'warn' | 'muted' | 'faint' } {
  if (!s) return { label: 'нет источника', tone: 'faint' };
  const m = playMode(s);
  if (m === 'player') return s.localPath ? { label: 'на телефоне', tone: 'ok' } : { label: 'целиком', tone: 'ok' };
  if (m === 'preview') return { label: 'фрагмент', tone: 'warn' };
  if (m === 'embed') return { label: s.source === 'youtube' ? 'YouTube' : sourceName(s.source), tone: 'ok' };
  if (s.availability === 'subscription_required') return { label: `${sourceName(s.source)}, подписка`, tone: 'muted' };
  if (s.availability === 'region_blocked') return { label: 'закрыто в регионе', tone: 'faint' };
  if (s.availability === 'gone') return { label: 'удалено', tone: 'faint' };
  return { label: `в ${sourceName(s.source)}`, tone: 'muted' };
}

