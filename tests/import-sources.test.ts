import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/platform/localMusic', () => ({ searchLocal: vi.fn(async () => []), readLocalLyrics: vi.fn() }));
vi.mock('@/platform/oauth', () => ({ spotifyAccessToken: vi.fn() }));
import { cleanImportedName, isAudioFile, parseFileName } from '@/import/fileNames';
import { mapOpenverseAudio, openverse } from '@/sources/openverse';
import { abilities, adapter, integrationOf, isPlayableHere, playMode, readySources, setDisabledSources } from '@/sources/registry';
import { memoryCtx, mockFetch } from './helpers';

afterEach(() => { setDisabledSources([]); vi.unstubAllGlobals(); });

describe('имена файлов из Telegram и с сайтов', () => {
  it('убирает ботов, каналы и адреса сайтов', () => {
    expect(cleanImportedName('Cadillac (@TgSoundBot)')).toBe('Cadillac');
    expect(cleanImportedName('Cadillac @smusic2bot')).toBe('Cadillac');
    expect(cleanImportedName('Cadillac [muzofond.fm]')).toBe('Cadillac');
    expect(cleanImportedName('Cadillac (t.me/somechannel)')).toBe('Cadillac');
    expect(cleanImportedName('Cadillac - www.hitmo.ru')).toBe('Cadillac');
    expect(cleanImportedName('Cadillac (скачано с сайта)')).toBe('Cadillac');
    expect(cleanImportedName('Cadillac (Remix)')).toBe('Cadillac (Remix)');
  });
  it('разбирает «Исполнитель - Название» из имени файла', () => {
    expect(parseFileName('MORGENSHTERN, Элджей - Cadillac (@TgSoundBot).mp3')).toEqual({ artist: 'MORGENSHTERN, Элджей', title: 'Cadillac' });
    expect(parseFileName('03. DEAD BLONDE – Мальчик на девятке.m4a')).toEqual({ artist: 'DEAD BLONDE', title: 'Мальчик на девятке' });
    expect(parseFileName('Lida_-_Lyubov.mp3')).toEqual({ artist: 'Lida', title: 'Lyubov' });
    expect(parseFileName('track.mp3')).toEqual({ title: 'track' });
    expect(parseFileName('kamerton-2.mp3')).toEqual({ title: 'kamerton-2' });
    expect(parseFileName('Miyagi-Captain.mp3')).toEqual({ artist: 'Miyagi', title: 'Captain' });
  });
  it('понимает, что файл — музыка, даже если Telegram не указал тип', () => {
    expect(isAudioFile('audio/mpeg', 'x')).toBe(true);
    expect(isAudioFile('application/octet-stream', 'song.flac')).toBe(true);
    expect(isAudioFile('image/jpeg', 'cover.jpg')).toBe(false);
  });
});

describe('Openverse', () => {
  const raw = { id: 'abc', title: 'Night Drive', creator: 'Some Artist', url: 'https://mp3.jamendo.com/?trackid=1&format=mp31', duration: 201000, genres: ['electronic'], license: 'by-sa', license_version: '3.0', provider: 'jamendo', foreign_landing_url: 'https://www.jamendo.com/track/1', thumbnail: 'https://api.openverse.org/v1/audio/abc/thumb/', filetype: 'mp3', bit_rate: 128000, mature: false };
  it('разбирает трек со свободной лицензией', () => {
    expect(mapOpenverseAudio(raw)).toMatchObject({ source: 'openverse', title: 'Night Drive', artist: 'Some Artist', durationSec: 201, availability: 'full', canOffline: true, attribution: 'CC BY-SA 3.0, jamendo', explicit: 'unknown' });
    expect(mapOpenverseAudio({ ...raw, url: '' })).toBeNull();
  });
  it('ищет только музыку и отдаёт прямую ссылку на файл', async () => {
    const calls = mockFetch([[/api\.openverse\.org\/v1\/audio/, { result_count: 1, results: [raw] }]]);
    const r = await openverse.search!(memoryCtx(), 'night drive', 20);
    expect(calls[0]).toContain('category=music');
    expect(r.tracks[0].title).toBe('Night Drive');
    expect((await openverse.resolveStream!(memoryCtx(), { ...r.tracks[0], id: 'openverse:abc', trackId: 't', fetchedAt: 0 } as never, 'normal')).uri).toBe(raw.url);
  });
});

describe('возможности и отключение источников', () => {
  it('таблица возможностей честная', () => {
    expect(abilities(adapter('openverse')!)).toEqual({ search: true, full: true, background: true, offline: true });
    expect(abilities(adapter('deezer')!)).toMatchObject({ search: true, full: false, background: false });
    expect(abilities(adapter('youtube')!)).toMatchObject({ full: true, background: false, offline: false });
    expect(integrationOf(adapter('local')!)).toBe('user-import');
    expect(integrationOf(adapter('yandex')!)).toBe('external-app');
  });
  it('выключенный источник не ищет и не играет', async () => {
    setDisabledSources(['deezer', 'audius']);
    expect(playMode({ source: 'deezer', availability: 'preview' })).toBe('none');
    expect(isPlayableHere({ source: 'audius', availability: 'full' })).toBe(false);
    expect(isPlayableHere({ source: 'jamendo', availability: 'full' })).toBe(true);
    const ready = await readySources(memoryCtx(), (a) => !!a.search);
    expect(ready.map((a) => a.id)).not.toContain('deezer');
    expect(ready.map((a) => a.id)).not.toContain('audius');
  });
});
