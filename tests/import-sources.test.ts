import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/platform/localMusic', () => ({ searchLocal: vi.fn(async () => []), readLocalLyrics: vi.fn() }));
vi.mock('@/platform/oauth', () => ({ spotifyAccessToken: vi.fn() }));
import { cleanImportedName, isAudioFile, parseFileName } from '@/import/fileNames';
import { mapOpenverseAudio, openverse } from '@/sources/openverse';
import { abilities, adapter, anyAdapter, integrationOf, isPlayableHere, playMode, readySources, setDisabledSources } from '@/sources/registry';
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
    const t = mapOpenverseAudio(raw)!;
    expect(t).toMatchObject({ source: 'openverse', title: 'Night Drive', artist: 'Some Artist', durationSec: 201, availability: 'full', explicit: 'unknown', licenseUrl: undefined, externalUrl: 'https://www.jamendo.com/track/1' });
    expect(t.attribution).toBe('CC BY-SA 3.0, Jamendo (найдено через Openverse)');
    // Песни Jamendo — только онлайн: условия Jamendo API запрещают офлайн в приложениях.
    expect(t.canOffline).toBe(false);
    expect(mapOpenverseAudio({ ...raw, provider: 'wikimedia_audio' })!.canOffline).toBe(true);
    expect(mapOpenverseAudio({ ...raw, provider: 'freesound' })!.canOffline).toBe(false);
    expect(mapOpenverseAudio({ ...raw, url: '' })).toBeNull();
  });
  it('звуковые эффекты и подкасты отсеиваются', () => {
    expect(mapOpenverseAudio({ ...raw, category: 'sound_effect' })).toBeNull();
    expect(mapOpenverseAudio({ ...raw, category: 'podcast' })).toBeNull();
    expect(mapOpenverseAudio({ ...raw, category: 'music', license: 'cc0' })!.attribution).toBe('CC0, Jamendo (найдено через Openverse)');
  });
  it('нет слов о проверке прав, есть отказ от одобрения Openverse', () => {
    const text = [openverse.doc.summary, ...openverse.doc.limits].join(' ');
    expect(text).toMatch(/не проверяет лицензии/);
    expect(text).toMatch(/не одобрял/);
    expect(text).not.toMatch(/разрешает (слушать|сохранять)/);
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
    expect(abilities(adapter('openverse')!)).toEqual({ search: true, full: 'player', background: true, offline: 'some' });
    expect(abilities(adapter('archive')!)).toMatchObject({ full: 'player', background: true, offline: 'all' });
    expect(abilities(adapter('deezer')!)).toMatchObject({ search: true, full: false, background: false, offline: false });
    // Ключ YouTube — не разрешение на фон, скачивание или извлечение звука.
    expect(abilities(adapter('youtube')!)).toEqual({ search: true, full: 'visible', background: false, offline: false });
    // Jamendo: условия API запрещают офлайн-доступ в приложениях.
    expect(abilities(adapter('jamendo')!)).toMatchObject({ full: 'player', background: true, offline: false });
    const yt = adapter('youtube')!;
    expect([yt.configFields![0].hint, ...yt.doc.limits].join(' ')).toMatch(/не (даёт права|разрешение)/);
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
    // Везде, где берут адаптер (артист, альбом, обложки, ссылки «слушать в…»), выключенного нет.
    expect(adapter('deezer')).toBeUndefined();
    expect(anyAdapter('deezer')?.id).toBe('deezer');
    setDisabledSources([]);
    expect(adapter('deezer')?.id).toBe('deezer');
  });
});
