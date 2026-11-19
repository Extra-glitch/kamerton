import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-network', () => ({ getNetworkStateAsync: async () => ({ type: 'WIFI' }), NetworkStateType: { CELLULAR: 'CELLULAR' } }));
vi.mock('@/platform/localMusic', () => ({ searchLocal: vi.fn(async () => []), readLocalLyrics: vi.fn() }));
vi.mock('@/platform/oauth', () => ({ spotifyAccessToken: vi.fn() }));
vi.mock('@/platform/secureConfig', async () => ({ sourceContext: (await import('./helpers')).memoryCtx({ youtube: { apiKey: 'test-key' } }) }));

import * as repo from '@/db/repo';
import { playVideos, setVideoResolver, stopVideo, useVideo, videoIdOf, videoNext } from '@/player/video';
import { findFullVersion, refreshYouTubeReady, scoreYouTubeMatch } from '@/services/fullVersion';
import { canPlayViaYouTube, playBadge } from '@/ui/musicBadge';
import { memoryDb, mockFetch } from './helpers';

const song = { title: 'Cadillac', artist: 'MORGENSHTERN, Элджей', durationSec: 168 };

describe('подбор полной версии на YouTube', () => {
  it('официальная запись подходит', () => {
    expect(scoreYouTubeMatch(song, { title: 'Cadillac', artist: 'MORGENSHTERN', channel: 'MORGENSHTERN - Topic', topic: true, durationSec: 169 })).toBeGreaterThan(0.85);
    expect(scoreYouTubeMatch(song, { title: 'Cadillac (Official Video)', artist: 'MORGENSHTERN', channel: 'MORGENSHTERN', durationSec: 185 })).toBeGreaterThanOrEqual(0.6);
  });
  it('каверы, ремиксы, караоке и чужие исполнители отсекаются', () => {
    expect(scoreYouTubeMatch(song, { title: 'Cadillac (кавер на гитаре)', artist: 'MORGENSHTERN', durationSec: 170 })).toBe(0);
    expect(scoreYouTubeMatch(song, { title: 'Cadillac slowed + reverb', artist: 'MORGENSHTERN', durationSec: 200 })).toBe(0);
    expect(scoreYouTubeMatch(song, { title: 'Cadillac', artist: 'Some Fan', channel: 'Some Fan', durationSec: 168 })).toBe(0);
    expect(scoreYouTubeMatch(song, { title: 'Cadillac', artist: 'MORGENSHTERN', durationSec: 600 })).toBe(0);
    expect(scoreYouTubeMatch(song, { title: 'Cadillac', artist: 'MORGENSHTERN', durationSec: 168, availability: 'region_blocked' })).toBe(0);
  });
  it('ремикс подходит, если в каталоге и есть ремикс', () => {
    expect(scoreYouTubeMatch({ title: 'Cadillac (Remix)', artist: 'MORGENSHTERN' }, { title: 'Cadillac (Remix)', artist: 'MORGENSHTERN' })).toBeGreaterThan(0.6);
  });
});

describe('песня из каталога играет целиком через YouTube', () => {
  beforeEach(async () => { await repo.initRepo(memoryDb()); stopVideo(); setVideoResolver(findFullVersion); await refreshYouTubeReady(); });

  const dz = { source: 'deezer', sourceTrackId: '1', title: 'Cadillac', artist: 'MORGENSHTERN', durationSec: 168, availability: 'preview' as const, explicit: 'explicit' as const, extra: { preview: 'p.mp3' } };

  it('видео находится, привязывается к той же записи и кэшируется', async () => {
    const calls = mockFetch([
      [/youtube\/v3\/search/, { items: [
        { id: { videoId: 'cover0000001' }, snippet: { title: 'Cadillac кавер', channelTitle: 'Fan' } },
        { id: { videoId: 'official0001' }, snippet: { title: 'Cadillac', channelTitle: 'MORGENSHTERN - Topic' } },
      ] }],
      [/youtube\/v3\/videos/, { items: [{ id: 'cover0000001', contentDetails: { duration: 'PT2M50S' }, status: { embeddable: true } }, { id: 'official0001', contentDetails: { duration: 'PT2M49S' }, status: { embeddable: true } }] }],
    ]);
    const id = await repo.upsertRemote(dz);
    const [t] = await repo.getViews([id]);
    expect(playBadge(t.preferred, true).label).toBe('YouTube');
    expect(playBadge(t.preferred, false).label).toBe('фрагмент');
    const full = await findFullVersion(t);
    expect(full?.id).toBe(t.id);
    expect(videoIdOf(full)).toBe('official0001');
    expect(full?.sources.map((s) => s.source).sort()).toEqual(['deezer', 'youtube']);
    const before = calls.length;
    await findFullVersion(t);
    expect(calls.length).toBe(before); // повторно квота не тратится
  });

  it('очередь из каталога: видео ищется перед каждой песней, ненайденная пропускается', async () => {
    mockFetch([
      [/youtube\/v3\/search.*Aristocrat/, { items: [] }],
      [/youtube\/v3\/search/, { items: [{ id: { videoId: 'official0001' }, snippet: { title: 'Cadillac', channelTitle: 'MORGENSHTERN - Topic' } }, { id: { videoId: 'official0003' }, snippet: { title: 'Ice', channelTitle: 'MORGENSHTERN - Topic' } }] }],
      [/youtube\/v3\/videos/, { items: [] }],
    ]);
    const ids = [await repo.upsertRemote(dz), await repo.upsertRemote({ ...dz, sourceTrackId: '2', title: 'Aristocrat' }), await repo.upsertRemote({ ...dz, sourceTrackId: '3', title: 'Ice', durationSec: undefined })];
    const list = await repo.getViews(ids);
    expect(list.every((x) => canPlayViaYouTube(x.preferred))).toBe(true);
    playVideos(list, 0);
    await vi.waitFor(() => expect(videoIdOf(useVideo.getState().queue[0])).toBe('official0001'));
    videoNext();
    await vi.waitFor(() => expect(useVideo.getState().index).toBe(2)); // Aristocrat не нашлась — сразу Ice
    expect(videoIdOf(useVideo.getState().queue[2])).toBe('official0003');
    expect(useVideo.getState().resolving).toBe(false);
  });
});
