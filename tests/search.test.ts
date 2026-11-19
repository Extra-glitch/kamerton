import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-network', () => ({ getNetworkStateAsync: async () => ({ type: 'WIFI' }), NetworkStateType: { CELLULAR: 'CELLULAR' } }));
vi.mock('@/platform/localMusic', () => ({ searchLocal: vi.fn(async () => []), readLocalLyrics: vi.fn() }));
vi.mock('@/platform/oauth', () => ({ spotifyAccessToken: vi.fn() }));
vi.mock('@/platform/secureConfig', async () => ({ sourceContext: (await import('./helpers')).memoryCtx() }));

import * as repo from '@/db/repo';
import { artistPage, federatedSearch, resolveStream } from '@/services/media';
import { memoryDb, mockFetch } from './helpers';

const dz = (id: number, title: string, artist: string, extra: object = {}) => ({ id, readable: true, title, link: `https://www.deezer.com/track/${id}`, duration: 170, rank: 1, explicit_lyrics: true, explicit_content_lyrics: 1, preview: `https://cdnt-preview.dzcdn.net/${id}.mp3`, artist: { id: 77, name: artist }, album: { id: 5, title: 'A', cover_big: 'c.jpg' }, ...extra });
const au = (id: string, title: string, name: string) => ({ id, title, duration: 200, genre: 'Electronic', is_streamable: true, is_available: true, access: { stream: true }, permalink: `/x/${id}`, user: { id: 'u', name, handle: 'h' }, artwork: { '480x480': 'm' } });

afterEach(() => vi.unstubAllGlobals());

describe('поиск по каталогу и свободным источникам', () => {
  beforeEach(async () => { await repo.initRepo(memoryDb()); repo.setSourceChoice({ directSources: new Set(['audius', 'local']), priority: ['local', 'audius'], versionFilter: 'original_first' }); });

  it('случайные совпадения свободных каталогов уходят в «похожие названия»', async () => {
    mockFetch([
      [/api\.deezer\.com\/search\/artist/, { data: [{ id: 77, name: 'MORGENSHTERN', picture_big: 'p.jpg', nb_fan: 10 }] }],
      [/api\.deezer\.com\/search\/album/, { data: [] }],
      [/api\.deezer\.com\/search/, { data: [dz(1, 'Cadillac', 'MORGENSHTERN'), dz(2, 'Aristocrat', 'MORGENSHTERN')] }],
      [/tracks\/search/, { data: [au('a1', 'Morning Shine', 'Free Sounds'), au('a2', 'Morgenshtern Tribute', 'Fan Band')] }],
      [/users\/search/, { data: [{ id: 'fake', name: 'Morgenshtern', follower_count: 24 }] }],
      [/playlists\/search/, { data: [] }],
    ]);
    const r = await federatedSearch('morgenshtern', { sources: ['deezer', 'audius'] });
    // Однофамилец со свободной площадки не подменяет карточку каталога.
    expect(r.topArtist).toMatchObject({ name: 'MORGENSHTERN', source: 'deezer', id: '77', imageUrl: 'p.jpg' });
    expect(r.topArtist?.sources.sort()).toEqual(['audius', 'deezer']);
    expect(r.tracks.map((t) => t.title)).toEqual(expect.arrayContaining(['Cadillac', 'Aristocrat', 'Morgenshtern Tribute']));
    expect(r.tracks.map((t) => t.title)).not.toContain('Morning Shine');
    expect(r.loose.map((t) => t.title)).toEqual(['Morning Shine']);
    // Фрагмент можно включить, а в волну он не попадает.
    const cad = r.tracks.find((t) => t.title === 'Cadillac')!;
    expect(cad.preferred?.availability).toBe('preview');
    expect((await resolveStream(cad.preferred!)).uri).toContain('dzcdn.net');
    expect(await repo.poolTrackIds()).not.toContain(cad.id);
  });

  it('песня с телефона и из каталога сливаются в одну запись, играет файл', async () => {
    await repo.upsertRemote({ source: 'local', sourceTrackId: 'f1', title: 'Cadillac', artist: 'MORGENSHTERN', durationSec: 168, availability: 'full', explicit: 'unknown' }, { library: true, localPath: 'file:///music/cadillac.mp3' });
    mockFetch([
      [/api\.deezer\.com\/search\/(artist|album)/, { data: [] }],
      [/api\.deezer\.com\/search/, { data: [dz(1, 'Cadillac', 'MORGENSHTERN', { duration: 168 })] }],
    ]);
    const r = await federatedSearch('cadillac', { sources: ['deezer'] });
    expect(r.tracks).toHaveLength(1);
    expect(r.tracks[0].sources.map((s) => s.source).sort()).toEqual(['deezer', 'local']);
    expect(r.tracks[0].preferred?.source).toBe('local');
    expect(r.tracks[0].explicit).toBe('explicit'); // пометка из каталога дополняет файл
  });

  it('страница исполнителя: популярное из каталога и альбомы', async () => {
    mockFetch([
      [/artist\/77\/top/, { data: [dz(1, 'Cadillac', 'MORGENSHTERN'), dz(3, 'Ice', 'MORGENSHTERN')] }],
      [/artist\/77\/albums/, { data: [{ id: 9, title: 'LAST ONE', release_date: '2021-12-31', record_type: 'album', cover_big: 'c.jpg' }] }],
      [/tracks\/search|users\/search|playlists\/search|advancedsearch|radio-browser/, { data: [], response: { docs: [] } }],
    ]);
    const p = await artistPage('MORGENSHTERN', '77');
    expect(p.top.map((t) => t.title)).toEqual(['Cadillac', 'Ice']);
    expect(p.albums[0]).toMatchObject({ title: 'LAST ONE', year: 2021 });
    expect(p.errors).toEqual([]);
  });
});
