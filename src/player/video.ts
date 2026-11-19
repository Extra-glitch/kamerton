// Очередь видео YouTube. Видео играет только во встроенном плеере YouTube, который виден
// на экране (правила YouTube): на экране плеера сверху или плавающей панелью над разделами.
// В фоне и при свёрнутой панели видео стоит на паузе.

import { create } from 'zustand';
import type { TrackView } from '@/core/types';

export interface VideoState {
  queue: TrackView[]; index: number; active: boolean; collapsed: boolean;
  playing: boolean; buffering: boolean; positionSec: number; durationSec: number; error: string | null;
  /** Идёт поиск полной версии песни из каталога на YouTube. */
  resolving: boolean;
}

export const useVideo = create<VideoState>(() => ({ queue: [], index: 0, active: false, collapsed: false, playing: false, buffering: false, positionSec: 0, durationSec: 0, error: null, resolving: false }));

let resolver: ((t: TrackView) => Promise<TrackView | null>) | null = null;
/** Как найти видео для песни из каталога (src/services/fullVersion.ts). */
export function setVideoResolver(fn: typeof resolver) { resolver = fn; }
let session = 0;

type Command = { cmd: 'load'; id: string } | { cmd: 'play' } | { cmd: 'pause' } | { cmd: 'seek'; sec: number };
let sender: ((c: Command) => void) | null = null;
let onStart: (() => void) | null = null;

/** Встроенный плеер регистрирует здесь способ отправки команд. */
export function registerVideoSender(fn: ((c: Command) => void) | null) { sender = fn; }
/** Чтобы два звука не смешивались, при старте видео плеер Камертона ставится на паузу. */
export function onVideoStart(fn: () => void) { onStart = fn; }

export const videoIdOf = (t?: TrackView | null): string | null => {
  const s = t?.sources.find((x) => x.source === 'youtube');
  return s ? (s.extra as { embed?: { id?: string } } | undefined)?.embed?.id ?? s.sourceTrackId : null;
};

export const currentVideo = () => { const s = useVideo.getState(); return s.active ? s.queue[s.index] ?? null : null; };

/**
 * Очередь видео. Песни без видео (из каталога) допускаются, если есть способ их найти:
 * видео ищется прямо перед тем, как песня должна заиграть, и только для неё.
 */
export function playVideos(tracks: TrackView[], index = 0) {
  const queue = resolver ? tracks : tracks.filter((t) => videoIdOf(t));
  const start = Math.max(0, queue.indexOf(tracks[index]));
  if (!queue.length) return;
  onStart?.();
  useVideo.setState({ queue, index: start, active: true, collapsed: false, playing: false, buffering: true, positionSec: 0, durationSec: queue[start].durationSec ?? 0, error: null });
  void go(start);
}

async function go(index: number, misses = 0) {
  const my = ++session;
  const s = useVideo.getState();
  if (index < 0 || index >= s.queue.length) { useVideo.setState({ playing: false, resolving: false }); return; }
  let t = s.queue[index];
  useVideo.setState({ index, positionSec: 0, durationSec: t.durationSec ?? 0, buffering: true, error: null, collapsed: false });
  if (!videoIdOf(t) && resolver) {
    useVideo.setState({ resolving: true });
    const found = await resolver(t).catch(() => null);
    if (my !== session) return; // пользователь уже включил другое
    useVideo.setState({ resolving: false });
    if (!found) {
      // Не нашлось: пропускаем песню, но не бесконечно.
      if (misses >= 4) { useVideo.setState({ playing: false, buffering: false, error: 'Для этих песен на YouTube не нашлось подходящего видео.' }); return; }
      void go(index + 1, misses + 1);
      return;
    }
    t = found;
    const q = [...useVideo.getState().queue];
    q[index] = found;
    useVideo.setState({ queue: q, durationSec: found.durationSec ?? 0 });
  }
  sender?.({ cmd: 'load', id: videoIdOf(t)! });
}

export const videoNext = () => { void go(useVideo.getState().index + 1); };
export const videoJump = (index: number) => { void go(index); };
export const videoPrev = () => { const s = useVideo.getState(); if (s.positionSec > 4) videoSeek(0); else void go(s.index - 1); };
export function videoToggle() {
  const s = useVideo.getState();
  if (s.collapsed) useVideo.setState({ collapsed: false });
  if (s.playing) sender?.({ cmd: 'pause' }); else { onStart?.(); sender?.({ cmd: 'play' }); }
}
export const videoPause = () => sender?.({ cmd: 'pause' });
export const videoSeek = (sec: number) => { useVideo.setState({ positionSec: sec }); sender?.({ cmd: 'seek', sec }); };
/** Свернуть панель: видео встаёт на паузу, потому что его больше не видно. */
export function setVideoCollapsed(collapsed: boolean) { if (collapsed) videoPause(); useVideo.setState({ collapsed }); }
export function stopVideo() { session++; videoPause(); useVideo.setState({ active: false, queue: [], index: 0, playing: false, collapsed: false, resolving: false }); }

/** Сообщения от встроенного плеера YouTube. */
export function handleVideoEvent(e: { t: string; s?: number; p?: number; d?: number; code?: number }) {
  if (e.t === 'state') {
    if (e.s === 0) { videoNext(); return; } // видео закончилось
    useVideo.setState({ playing: e.s === 1, buffering: e.s === 3 });
  } else if (e.t === 'time') {
    useVideo.setState({ positionSec: e.p ?? 0, durationSec: e.d || useVideo.getState().durationSec });
  } else if (e.t === 'error') {
    const embedBlocked = e.code === 101 || e.code === 150;
    useVideo.setState({ error: embedBlocked ? 'Владелец запретил показывать это видео в других приложениях. Включаем следующее.' : 'Видео не загрузилось. Проверьте интернет и VPN.' });
    if (embedBlocked || e.code === 100) setTimeout(videoNext, 1200);
  }
}
