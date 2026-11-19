import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-network', () => ({ getNetworkStateAsync: async () => ({ type: 'WIFI' }), NetworkStateType: { CELLULAR: 'CELLULAR' } }));
vi.mock('@/platform/localMusic', () => ({ searchLocal: vi.fn(async () => []), readLocalLyrics: vi.fn() }));
vi.mock('@/platform/oauth', () => ({ spotifyAccessToken: vi.fn(async () => null) }));
vi.mock('@/platform/secureConfig', async () => ({ sourceContext: (await import('./helpers')).memoryCtx({ youtube: { apiKey: 'YT' }, soundcloud: { clientId: 'id', clientSecret: 'sec' } }) }));

import * as repo from '@/db/repo';
import { latinToCyrillic, queryVariants } from '@/search/variants';
import { runSearch, setSearchTimeout, useSearch } from '@/search/engine';
import { handleVideoEvent, playVideos, registerVideoSender, useVideo, videoIdOf } from '@/player/video';
import { useSettings } from '@/state/settings';
import { isoDuration, mapYouTubeVideo } from '@/sources/youtube';
import { mapSoundCloudTrack } from '@/sources/soundcloud';
import { memoryDb, view } from './helpers';

afterEach(() => vi.unstubAllGlobals());

describe('варианты написания', () => {
  it('кириллица и латиница', () => {
    expect(queryVariants('Моргенштерн')).toEqual(['Моргенштерн', 'morgenshtern']);
    expect(queryVariants('Дэд Блонд')).toEqual(['Дэд Блонд', 'ded blond']);
    expect(queryVariants('DEAD BLONDE')).toEqual(['DEAD BLONDE', 'деад блонде']);
    expect(latinToCyrillic('morgenshtern')).toBe('моргенштерн');
    expect(queryVariants('  ')).toEqual([]);
  });
});

describe('разбор YouTube и SoundCloud', () => {
  it('видео канала «Исполнитель - Topic» — это сама песня', () => {
    const t = mapYouTubeVideo({ id: { videoId: 'abcdefghijk' }, snippet: { title: 'Cadillac', channelTitle: 'MORGENSHTERN - Topic', publishedAt: '2020-09-01T00:00:00Z', thumbnails: { high: { url: 'h.jpg' } } } }, { contentDetails: { duration: 'PT2M48S' }, status: { embeddable: true } });
    expect(t).toMatchObject({ source: 'youtube', title: 'Cadillac', artist: 'MORGENSHTERN', durationSec: 168, availability: 'full', coverUrl: 'h.jpg' });
    expect(isoDuration('PT1H2M3S')).toBe(3723);
  });
  it('клип: «Исполнитель - Песня (Official Video)», запрет в регионе', () => {
    const t = mapYouTubeVideo({ id: { videoId: 'abcdefghijk' }, snippet: { title: 'DEAD BLONDE - Мальчик на девятке (Official Video)', channelTitle: 'DEAD BLONDE' } }, { contentDetails: { duration: 'PT2M30S', regionRestriction: { blocked: ['RU'] } } });
    expect(t).toMatchObject({ title: 'Мальчик на девятке', artist: 'DEAD BLONDE', availability: 'region_blocked' });
  });
  it('SoundCloud: поле access решает, целиком или фрагмент', () => {
    const base = { urn: 'soundcloud:tracks:1', title: 'Любовь', user: { username: 'lida' }, duration: 181000, artwork_url: 'https://i1.sndcdn.com/a-large.jpg', permalink_url: 'https://soundcloud.com/lida/x', publisher_metadata: { artist: 'Лида', explicit: true } };
    expect(mapSoundCloudTrack({ ...base, access: 'playable' })).toMatchObject({ artist: 'Лида', availability: 'full', explicit: 'explicit', durationSec: 181, coverUrl: 'https://i1.sndcdn.com/a-t500x500.jpg' });
    expect(mapSoundCloudTrack({ ...base, access: 'preview' }).availability).toBe('preview');
    expect(mapSoundCloudTrack({ ...base, access: 'blocked' }).availability).toBe('region_blocked');
  });
});

const dz = (id: number, title: string, artist: string, duration = 168) => ({ id, readable: true, title, link: `https://www.deezer.com/track/${id}`, duration, rank: 1, explicit_lyrics: true, explicit_content_lyrics: 1, preview: `https://cdnt-preview.dzcdn.net/${id}.mp3`, artist: { id: 77, name: artist }, album: { id: 5, title: 'A', cover_big: 'c.jpg' } });

describe('единый поиск', () => {
  beforeEach(async () => {
    await repo.initRepo(memoryDb());
    repo.setSourceChoice({ directSources: new Set(['audius', 'local', 'soundcloud']), priority: ['local', 'soundcloud', 'audius'], versionFilter: 'original_first' });
    useSettings.setState({ musicBrainzEnabled: false });
    setSearchTimeout(2500);
  });

  it('опрашивает источники параллельно, объединяет одну песню и не ждёт зависший сервис', async () => {
    const seen: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      seen.push(url);
      const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (url.includes('api.deezer.com/search/artist')) return json({ data: [{ id: 77, name: 'MORGENSHTERN', picture_big: 'p.jpg', nb_fan: 10 }] });
      if (url.includes('api.deezer.com/search/album')) return json({ data: [] });
      if (url.includes('api.deezer.com/search')) return json({ data: url.includes('morgenshtern') || url.includes('%D0%BC%D0%BE%D1%80') ? [dz(1, 'Cadillac', 'MORGENSHTERN'), dz(2, 'Aristocrat', 'MORGENSHTERN', 150)] : [] });
      if (url.includes('googleapis.com/youtube/v3/search')) return json({ items: [{ id: { videoId: 'aaaaaaaaaaa' }, snippet: { title: 'Cadillac', channelTitle: 'MORGENSHTERN - Topic' } }] });
      if (url.includes('googleapis.com/youtube/v3/videos')) return json({ items: [{ id: 'aaaaaaaaaaa', contentDetails: { duration: 'PT2M48S' }, status: { embeddable: true } }] });
      if (url.includes('secure.soundcloud.com/oauth/token')) return json({ access_token: 'T', expires_in: 3600 });
      if (url.includes('api.soundcloud.com/tracks')) return json({ collection: [{ urn: 'soundcloud:tracks:9', kind: 'track', title: 'Show', user: { username: 'MORGENSHTERN' }, duration: 160000, access: 'playable' }] });
      if (url.includes('api.audius.co') && url.includes('tracks/search')) return json({ data: [{ id: 'x1', title: 'Morning Shine', duration: 200, is_streamable: true, user: { id: 'u', name: 'Free Sounds' }, artwork: {} }] });
      if (url.includes('api.audius.co')) return json({ data: [] });
      if (url.includes('itunes.apple.com')) return new Promise<Response>(() => undefined); // завис
      return json({ data: [], results: [], response: { docs: [] } });
    }));
    await runSearch('Моргенштерн');
    const s = useSearch.getState();
    expect(s.done).toBe(true);
    const run = (id: string) => s.runs.find((r) => r.id === id)!;
    if (process.env.DEBUG_SEARCH) console.error(JSON.stringify(s.runs.map((r) => [r.id, r.state, r.received, r.matched, r.error])));
    expect(run('deezer').state).toBe('ok');
    expect(run('youtube')).toMatchObject({ state: 'ok', matched: 1 });
    expect(run('soundcloud')).toMatchObject({ state: 'ok', matched: 1 });
    expect(run('itunes').state).toBe('timeout');
    expect(run('spotify').state).toBe('needs_setup');
    expect(run('audius')).toMatchObject({ state: 'ok', received: 1, matched: 0 });
    // Cadillac из Deezer и с YouTube — одна запись, играет YouTube (целиком), а не фрагмент.
    const cad = s.tracks.find((t) => t.title === 'Cadillac')!;
    expect(cad.sources.map((x) => x.source).sort()).toEqual(['deezer', 'youtube']);
    expect(cad.preferred?.source).toBe('youtube');
    expect(s.tracks.map((t) => t.title)).toEqual(expect.arrayContaining(['Cadillac', 'Aristocrat', 'Show']));
    expect(s.loose.map((t) => t.title)).toEqual(['Morning Shine']);
    expect(s.topArtist?.name).toBe('MORGENSHTERN');
    // Кириллический запрос ушёл в каталог и в транслитерации, а в YouTube только один раз (квота).
    expect(seen.filter((u) => u.includes('api.deezer.com/search?')).length).toBe(2);
    expect(seen.filter((u) => u.includes('youtube/v3/search')).length).toBe(1);
  });
});

describe('видео YouTube', () => {
  it('очередь, конец видео и запрет встраивания', async () => {
    vi.useFakeTimers();
    const sent: unknown[] = [];
    registerVideoSender((c) => sent.push(c));
    const yt = (id: string, title: string) => view(id, { title, sources: [{ id: `youtube:${id}`, trackId: id, source: 'youtube', sourceTrackId: id, title, artist: 'A', availability: 'full', explicit: 'unknown', fetchedAt: 0, extra: { embed: { provider: 'youtube', id } } } as never] });
    const list = [yt('v1aaaaaaaaa', 'Один'), yt('v2aaaaaaaaa', 'Два'), yt('v3aaaaaaaaa', 'Три')];
    expect(videoIdOf(list[0])).toBe('v1aaaaaaaaa');
    playVideos(list, 0);
    expect(sent.at(-1)).toEqual({ cmd: 'load', id: 'v1aaaaaaaaa' });
    handleVideoEvent({ t: 'state', s: 1 });
    expect(useVideo.getState().playing).toBe(true);
    handleVideoEvent({ t: 'state', s: 0 }); // закончилось
    expect(useVideo.getState().index).toBe(1);
    expect(sent.at(-1)).toEqual({ cmd: 'load', id: 'v2aaaaaaaaa' });
    handleVideoEvent({ t: 'error', code: 150 }); // владелец запретил встраивание
    vi.advanceTimersByTime(1500);
    expect(useVideo.getState().index).toBe(2);
    vi.useRealTimers();
  });
});

describe('порядок результатов', () => {
  it('оригинал исполнителя выше перезаливов, каверов и ремиксов', async () => {
    const { searchScore } = await import('@/search/rank');
    const src = (source: string, availability = 'full') => [{ id: `${source}:1`, trackId: 't', source, sourceTrackId: '1', title: '', artist: '', availability, explicit: 'unknown', fetchedAt: 0 }] as never;
    const orig = view('o', { title: 'Blinding Lights', artist: 'The Weeknd', sources: src('deezer', 'preview') });
    orig.preferred = orig.sources[0];
    const remix = view('r', { title: 'Blinding Lights - Zaza Remix', artist: 'zaza', sources: src('audius') });
    remix.preferred = remix.sources[0];
    const cover = view('c', { title: 'The Weeknd Blinding Lights - [COVER]', artist: 'DJ-M', sources: src('audius') });
    cover.preferred = cover.sources[0];
    const v = ['Blinding Lights'];
    expect(searchScore(v, orig)).toBeGreaterThan(searchScore(v, remix));
    expect(searchScore(v, orig)).toBeGreaterThan(searchScore(v, cover) + 20);
    const reup = view('u', { title: 'MORGENSHTERN - B', artist: 'TAnO4Ek', sources: src('audius') });
    reup.preferred = reup.sources[0];
    const real = view('m', { title: 'АНТИДЕПРЕССАНТЫ', artist: 'Morgenshtern', sources: src('deezer', 'preview') });
    real.preferred = real.sources[0];
    expect(searchScore(['Моргенштерн', 'morgenshtern'], real)).toBeGreaterThan(searchScore(['Моргенштерн', 'morgenshtern'], reup));
  });
});
