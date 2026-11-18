import { createAudioPlaylist, setAudioModeAsync, type AudioPlaylist, type AudioPlaylistStatus } from 'expo-audio';
import { displayCover } from '@/sources/subsonic';
import type { AudioDriver, DriverStatus, DriverTrack, NowPlayingInfo } from './controller';

type Loop = 'none' | 'single' | 'all';
const src = (t: DriverTrack) => ({ uri: t.uri, headers: t.headers });

/**
 * Обёртка над нативным плейлистом expo-audio (ExoPlayer на Android).
 * Он сам переключает треки в фоне и поддерживает кнопки на экране блокировки и наушниках.
 *
 * Нативный плеер подготавливается только при создании и после ошибки сам не восстанавливается,
 * поэтому каждая новая очередь получает новый экземпляр.
 */
export function createDriver(): AudioDriver {
  let pl: AudioPlaylist | null = null;
  let statusCb: (s: DriverStatus) => void = () => undefined;
  let changeCb: (a: number, b: number) => void = () => undefined;
  let errorCb: (m: string) => void = () => undefined;
  let lockLive: boolean | null = null;
  let volume = 1;
  let loop: Loop = 'none';
  void setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: 'doNotMix', allowsRecording: false, shouldRouteThroughEarpiece: false });

  function replace(tracks: DriverTrack[]) {
    pl?.destroy();
    const inst = createAudioPlaylist({ sources: tracks.map(src), updateInterval: 500, loop });
    inst.volume = volume;
    inst.addListener('playlistStatusUpdate', (s: AudioPlaylistStatus & { error?: { message?: string } | string }) => {
      if (pl !== inst) return;
      if (s.error) errorCb(typeof s.error === 'string' ? s.error : s.error.message ?? 'ошибка потока');
      statusCb({ index: s.currentIndex, positionSec: s.currentTime, durationSec: s.duration, playing: s.playing, buffering: s.isBuffering, loaded: s.isLoaded, didFinish: s.didJustFinish });
    });
    inst.addListener('trackChanged', (d) => { if (pl === inst) changeCb(d.previousIndex, d.currentIndex); });
    pl = inst;
    lockLive = null; // новый экземпляр нужно заново связать с экраном блокировки
  }

  return {
    load(tracks, index) { replace(tracks); if (index > 0) pl!.skipTo(index); },
    append: (t) => pl?.add(src(t)),
    removeAt: (i) => pl?.remove(i),
    skipTo: (i) => pl?.skipTo(i),
    play: () => pl?.play(),
    pause: () => pl?.pause(),
    seek: async (s) => { await pl?.seekTo(s); },
    setVolume: (v) => { volume = v; if (pl) pl.volume = v; },
    setLoop: (m) => { loop = m; if (pl) pl.loop = m; },
    setNowPlaying(info: NowPlayingInfo) {
      if (!pl) return;
      const meta = { title: info.title, artist: info.artist, albumTitle: info.album, artworkUrl: displayCover(info.artworkUrl) };
      const options = { showNextTrack: !info.isLive, showPreviousTrack: !info.isLive, isLiveStream: !!info.isLive };
      // На Android без активации экрана блокировки система остановит фоновое воспроизведение.
      if (lockLive !== !!info.isLive) { pl.setActiveForLockScreen(true, meta, options); lockLive = !!info.isLive; }
      else pl.updateLockScreenMetadata(meta);
    },
    onStatus: (cb) => { statusCb = cb; },
    onTrackChange: (cb) => { changeCb = cb; },
    onError: (cb) => { errorCb = cb; },
  };
}
