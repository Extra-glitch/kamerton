import { create } from 'zustand';
import type { TrackView } from '@/core/types';
import { openDatabase } from '@/db/driver';
import * as repo from '@/db/repo';
import { PlayerController, type PersistedPlayer, type PlayerSnapshot } from '@/player/controller';
import { createDriver } from '@/player/driver';
import { newQid, type QueueItem } from '@/player/queue';
import { sourceContext } from '@/platform/secureConfig';
import { adapter } from '@/sources/registry';
import { setSubsonicDisplayConfig } from '@/sources/subsonic';
import { onVideoStart, setVideoResolver, stopVideo, useVideo, videoPause } from '@/player/video';
import { findFullVersion, refreshYouTubeReady } from '@/services/fullVersion';
import { previewIds, resolveStream, sourceCtx } from '@/services/media';
import { invalidateReco, nextWave, radioBatch, surpriseMe } from '@/services/reco';
import { artistKey } from '@/reco/engine';
import { settings, useSettings } from './settings';

export let player: PlayerController;

export const usePlayer = create<PlayerSnapshot>(() => ({
  queue: [], index: -1, current: null, source: null, playing: false, buffering: false, positionSec: 0, durationSec: 0,
  shuffle: false, repeat: 'off', context: '', error: null, sleepAt: null, fade: false, volume: 1,
}));

// dataVersion меняется при правках библиотеки, playVersion только после прослушиваний.
interface UiStore { sheetTrack: TrackView | null; toast: string | null; dataVersion: number; playVersion: number }
export const useUi = create<UiStore>(() => ({ sheetTrack: null, toast: null, dataVersion: 0, playVersion: 0 }));
export const openSheet = (t: TrackView) => useUi.setState({ sheetTrack: t });
export const closeSheet = () => useUi.setState({ sheetTrack: null });
let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(text: string) {
  useUi.setState({ toast: text });
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => useUi.setState({ toast: null }), 3200);
}
export const bumpData = () => { invalidateReco(); useUi.setState((s) => ({ dataVersion: s.dataVersion + 1 })); };

async function refill(context: string, queue: QueueItem[]): Promise<QueueItem[]> {
  const ids = queue.map((q) => q.trackId);
  const toQueue = (l: { trackId: string; sourceTrackId: string; reason: string; bucket: string }[]) => l.map((x) => ({ ...x, qid: newQid() }));
  if (context === 'wave' || context === 'surprise') {
    const views = await repo.getViews(ids.slice(-5));
    const list = context === 'wave' ? await nextWave(12, ids, views.map((v) => artistKey(v.artist))) : await surpriseMe(10, ids);
    return toQueue(list);
  }
  if (context.startsWith('radio:')) {
    const [, seed] = context.split(':');
    const round = Math.floor(queue.length / 10) + 1;
    return toQueue(await radioBatch(seed, round, ids));
  }
  return [];
}

let booted: Promise<void> | null = null;

export function boot(): Promise<void> {
  booted ??= (async () => {
    await repo.initRepo(await openDatabase());
    await useSettings.getState().load();
    setSubsonicDisplayConfig(await sourceContext.getConfig('subsonic'));
    const driver = createDriver();
    player = new PlayerController({
      driver, getViews: repo.getViews,
      resolve: resolveStream,
      async recordPlay(p, bucket) {
        if (!settings().recordHistory) return;
        // Фрагменты не считаются прослушиваниями: иначе 30 секунд выглядели бы как пропуск.
        if (previewIds.has(p.sourceTrackId) || adapter(p.sourceTrackId.split(':')[0])?.capabilities.playback === 'preview-only') return;
        await repo.addPlay(p);
        invalidateReco();
        if (bucket) {
          if (p.completed) await repo.updateBandit(bucket as never, true);
          else if (p.skipped && p.listenedMs < 30000) await repo.updateBandit(bucket as never, false);
        }
        useUi.setState((s) => ({ playVersion: s.playVersion + 1 }));
      },
      saveState: (s) => repo.kvSet('player', s),
      onStarted: (s) => { const a = adapter(s.source); if (a?.onPlayStarted) void a.onPlayStarted(sourceCtx, s).catch(() => undefined); },
      onFinished: (s) => { const a = adapter(s.source); if (a?.onPlayFinished) void a.onPlayFinished(sourceCtx, s).catch(() => undefined); },
      markUnavailable: async () => undefined,
      refill,
    });
    player.setFade(settings().fade);
    player.setUserVolume(settings().volume);
    player.subscribe((s) => { usePlayer.setState(s); if (s.playing && useVideo.getState().playing) videoPause(); });
    // Видео YouTube и плеер Камертона не звучат одновременно.
    onVideoStart(() => player.pause());
    // Песни из каталога могут играть целиком через YouTube, если он подключён.
    setVideoResolver(findFullVersion);
    void refreshYouTubeReady();
    // Выключили или включили источник: пересчитываем, может ли каталог играть через YouTube.
    useSettings.subscribe((n, o) => { if (n.disabledSources !== o.disabledSources) void refreshYouTubeReady(); });
    const saved = await repo.kvGet<PersistedPlayer | null>('player', null);
    if (saved) await player.restore(saved).catch(() => undefined);
  })();
  return booted;
}

/** Запуск списка треков с автоматическим выбором источника. */
export function playTracks(tracks: TrackView[], start = 0, context = 'list') {
  stopVideo();
  const items = tracks.map((t) => ({ trackId: t.id, sourceTrackId: t.preferred?.id }));
  return player.playList(items, start, context);
}
