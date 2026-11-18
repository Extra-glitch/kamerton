import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { archive, mapArchiveItem } from '@/sources/archive';
import { audius, mapAudiusTrack } from '@/sources/audius';
import { jamendo, licenseName, mapJamendoTrack } from '@/sources/jamendo';
import { mapStation, radio, resetRadioServers } from '@/sources/radio';
import { authParams, displayCover, mapChild, setSubsonicDisplayConfig, subsonic } from '@/sources/subsonic';
import { parseYouTubeId } from '@/sources/youtube';
import { md5 } from '@/core/md5';
import { memoryCtx, mockFetch } from './helpers';

// Формы ответов сверены с живыми API Audius и Internet Archive и с документацией Jamendo и OpenSubsonic.
const audiusTrack = {
  id: 'mWB22', title: 'Ambient Snow', duration: 509, genre: 'Experimental', mood: 'Peaceful', tags: 'snow,calm', isrc: null, bpm: 101, parental_warning_type: null,
  is_streamable: true, is_stream_gated: false, is_available: true, is_delete: false, access: { stream: true, download: true }, preview: null, permalink: '/blopin/ambient-snow',
  remix_of: { tracks: [] }, cover_original_song_title: null, release_date: '2022-02-22T18:41:50Z', play_count: 12707, user: { id: 'oY08v', name: 'Blop', handle: 'blopin' },
  artwork: { '150x150': 's', '480x480': 'm', '1000x1000': 'l' },
};

afterEach(() => vi.unstubAllGlobals());

describe('Audius', () => {
  it('разбирает трек', () => {
    expect(mapAudiusTrack(audiusTrack)).toMatchObject({ sourceTrackId: 'mWB22', artist: 'Blop', availability: 'full', explicit: 'unknown', bpm: 101, mood: 'Peaceful', coverUrl: 'm', year: 2022, tags: ['Experimental', 'snow', 'calm'] });
  });
  it('различает статусы и версии', () => {
    expect(mapAudiusTrack({ ...audiusTrack, is_stream_gated: true, access: { stream: false } }).availability).toBe('subscription_required');
    expect(mapAudiusTrack({ ...audiusTrack, is_stream_gated: true, access: { stream: false }, preview_cid: 'x' }).availability).toBe('preview');
    expect(mapAudiusTrack({ ...audiusTrack, is_delete: true }).availability).toBe('gone');
    expect(mapAudiusTrack({ ...audiusTrack, parental_warning_type: 'Explicit' }).explicit).toBe('explicit');
    expect(mapAudiusTrack({ ...audiusTrack, parental_warning_type: 'NotExplicit' }).explicit).toBe('not_explicit');
    expect(mapAudiusTrack({ ...audiusTrack, parental_warning_type: 'ExplicitContentEdited' }).explicit).toBe('clean');
    expect(mapAudiusTrack({ ...audiusTrack, remix_of: { tracks: [{}] } }).title).toBe('Ambient Snow (Remix)');
  });
  it('ищет и строит адрес потока', async () => {
    const calls = mockFetch([[/tracks\/search/, { data: [audiusTrack] }], [/users\/search/, { data: [{ id: 'u', name: 'Blop' }] }], [/playlists\/search/, { data: [{ id: 'p', playlist_name: 'L', is_album: true, user: { name: 'Blop' } }] }]]);
    const ctx = memoryCtx();
    const r = await audius.search!(ctx, 'снег', 5);
    expect(r.tracks).toHaveLength(1); expect(r.artists[0].name).toBe('Blop'); expect(r.albums[0].title).toBe('L');
    expect(calls[0]).toContain('query=%D1%81%D0%BD%D0%B5%D0%B3');
    expect((await audius.resolveStream!(ctx, r.tracks[0], 'high')).uri).toBe('https://api.audius.co/v1/tracks/mWB22/stream?app_name=kamerton');
  });
});

describe('Jamendo', () => {
  const t = { id: '1', name: 'Song', duration: 180, artist_id: '7', artist_name: 'A', album_name: 'Al', album_id: '9', position: 2, releasedate: '2020-05-01', album_image: 'c', audio: 'https://prod-1.storage.jamendo.com/?trackid=1&format=mp31&from=x', license_ccurl: 'http://creativecommons.org/licenses/by-nc-sa/3.0/', shareurl: 'u', musicinfo: { tags: { genres: ['rock'], vartags: ['happy'], instruments: ['guitar'] } } };
  it('разбирает трек и лицензию', () => {
    const r = mapJamendoTrack(t);
    expect(r).toMatchObject({ availability: 'full', explicit: 'unknown', year: 2020, tags: ['rock', 'happy', 'guitar'] });
    expect(r.attribution).toContain('CC BY-NC-SA');
    expect(licenseName('https://creativecommons.org/licenses/by/4.0/')).toBe('CC BY');
  });
  it('без ключа сообщает, что нужна настройка, и не притворяется подключённым', async () => {
    expect((await jamendo.status(memoryCtx())).state).toBe('needs_setup');
    await expect(jamendo.search!(memoryCtx(), 'x', 1)).rejects.toThrow(/client_id/);
  });
  it('меняет формат потока по настройке качества', async () => {
    const ctx = memoryCtx({ jamendo: { clientId: 'k' } });
    const r = mapJamendoTrack(t);
    expect((await jamendo.resolveStream!(ctx, r, 'high')).uri).toContain('format=mp32');
    const low = await jamendo.resolveStream!(ctx, r, 'data_saver');
    expect(low.uri).toContain('format=mp31'); expect(low.quality?.bitrateKbps).toBe(96);
  });
  it('передаёт ошибку ключа', async () => {
    mockFetch([[/jamendo/, { headers: { status: 'failed', code: 5, error_message: 'Your credential is not authorized.' }, results: [] }]]);
    await expect(jamendo.verify!(memoryCtx({ jamendo: { clientId: 'bad' } }))).rejects.toThrow(/not authorized/);
  });
});

describe('Internet Archive', () => {
  const item = {
    metadata: { identifier: 'show1', title: 'Концерт', creator: ['Группа'], date: '1999-05-01', subject: 'jazz; live', licenseurl: 'https://creativecommons.org/licenses/by/3.0/', downloads: 120 },
    files: [
      { name: 'd1t02.flac', format: 'Flac', source: 'original', title: 'Вторая', track: '2', length: '200.5' }, { name: 'd1t02.mp3', format: 'VBR MP3', source: 'derivative', length: '03:20' },
      { name: 'd1t01.flac', format: 'Flac', source: 'original', title: 'Первая', track: '1', length: '100' }, { name: 'd1t01_vbr.mp3', format: 'VBR MP3', source: 'derivative' }, { name: 'd1t01.ogg', format: 'Ogg Vorbis', source: 'derivative' },
      { name: 'cover.jpg', format: 'JPEG' }, { name: 'info.txt', format: 'Text' },
    ],
  };
  it('собирает дорожки из разных форматов одного файла', () => {
    const t = mapArchiveItem(item);
    expect(t.map((x) => x.title)).toEqual(['Первая', 'Вторая']);
    expect(t[0]).toMatchObject({ artist: 'Группа', album: 'Концерт', year: 1999, canOffline: true, explicit: 'unknown' });
    expect(t[0].quality?.lossless).toBe(true);
  });
  it('выбирает файл по качеству', async () => {
    const t = mapArchiveItem(item)[0];
    const c = memoryCtx();
    expect((await archive.resolveStream!(c, t, 'lossless')).uri).toBe('https://archive.org/download/show1/d1t01.flac');
    expect((await archive.resolveStream!(c, t, 'normal')).uri).toContain('d1t01_vbr.mp3');
    expect((await archive.resolveStream!(c, t, 'data_saver')).uri).toContain('d1t01.ogg');
  });
  it('уважает ограничения записи', () => {
    expect(mapArchiveItem({ ...item, metadata: { ...item.metadata, stream_only: 'true' } })[0].canOffline).toBe(false);
    expect(mapArchiveItem({ ...item, is_dark: true })).toEqual([]);
    expect(mapArchiveItem({ ...item, metadata: { ...item.metadata, 'access-restricted-item': 'true' } })[0].availability).toBe('subscription_required');
  });
  it('работает, когда поиск вернул только идентификаторы', async () => {
    mockFetch([[/advancedsearch/, { response: { docs: [{ identifier: 'show1' }] } }], [/metadata\/show1/, item]]);
    const r = await archive.search!(memoryCtx(), 'джаз: (live)', 5);
    expect(r.tracks).toHaveLength(2); expect(r.albums[0].title).toBe('Концерт');
  });
});

describe('Radio Browser', () => {
  beforeEach(resetRadioServers);
  const station = { stationuuid: 'u1', name: 'Станция', url: 'http://a', url_resolved: 'https://b/stream', favicon: 'f', tags: 'rock,indie', country: 'Россия', codec: 'MP3', bitrate: 128, lastcheckok: 1, clickcount: 10 };
  it('разбирает станцию как живой эфир', () => {
    expect(mapStation(station)).toMatchObject({ isLive: true, availability: 'full', tags: ['rock', 'indie'], quality: { bitrateKbps: 128 } });
    expect(mapStation({ ...station, lastcheckok: 0 }).availability).toBe('gone');
  });
  it('получает сервера из каталога и сообщает о запуске станции', async () => {
    const calls = mockFetch([[/all\.api/, [{ name: 'x1.api.radio-browser.info' }]], [/x1\.api.*search/, [station]], [/x1\.api.*json\/url/, { ok: true }]]);
    const r = await radio.search!(memoryCtx(), 'рок', 5);
    expect(r.tracks[0].title).toBe('Станция');
    await radio.onPlayStarted!(memoryCtx(), r.tracks[0]);
    expect(calls.some((c) => c.includes('/json/url/u1'))).toBe(true);
    expect((await radio.resolveStream!(memoryCtx(), r.tracks[0], 'high')).uri).toBe('https://b/stream');
  });
});

describe('Subsonic / OpenSubsonic', () => {
  const cfg = { url: 'https://m.example/', username: 'u', password: 'секрет' };
  const song = { id: 's1', title: 'T', artist: 'A', displayArtist: 'A feat. B', album: 'Al', albumId: 'a1', duration: 100, suffix: 'flac', bitRate: 900, samplingRate: 96000, bitDepth: 24, isrc: ['USX1'], explicitStatus: 'explicit', musicBrainzId: 'mb', genres: [{ name: 'Rock' }], moods: ['calm'], bpm: 90, coverArt: 'c1' };
  it('считает токен с солью', () => {
    const a = authParams(cfg);
    expect(a.t).toBe(md5(`${cfg.password}${a.s}`)); expect(a.s.length).toBeGreaterThanOrEqual(6); expect(a).not.toHaveProperty('p');
    expect(authParams({ ...cfg, apiKey: 'k' })).toMatchObject({ apiKey: 'k' });
  });
  it('разбирает расширенные поля', () => {
    expect(mapChild(song, { ...cfg, url: 'https://m.example' })).toMatchObject({ artist: 'A feat. B', isrc: 'USX1', explicit: 'explicit', mbid: 'mb', bpm: 90, quality: { lossless: true, bitDepth: 24 } });
    expect(mapChild({ ...song, explicitStatus: '' }, cfg).explicit).toBe('unknown');
  });
  it('токены не попадают в сохраняемые данные трека', () => {
    const t = mapChild(song, { ...cfg, url: 'https://m.example' });
    expect(JSON.stringify(t)).not.toMatch(/[?&](t|s|apiKey|p)=/);
    expect(t.coverUrl).toBe('subsonic-cover:c1');
    setSubsonicDisplayConfig({});
    expect(displayCover(t.coverUrl)).toBeUndefined();
    setSubsonicDisplayConfig(cfg);
    expect(displayCover(t.coverUrl)).toMatch(/^https:\/\/m\.example\/rest\/getCoverArt\?.*id=c1/);
    expect(displayCover(t.coverUrl)).toBe(displayCover(t.coverUrl)); // адрес стабилен, иначе обложка будет перекачиваться
    expect(displayCover('https://x/y.png')).toBe('https://x/y.png');
  });
  it('обрабатывает ответ и ошибку сервера', async () => {
    mockFetch([[/ping/, { 'subsonic-response': { status: 'failed', error: { code: 40, message: 'Wrong username or password' } } }], [/search3/, { 'subsonic-response': { status: 'ok', searchResult3: { song: [song], album: [{ id: 'a1', name: 'Al', artist: 'A' }] } } }]]);
    const ctx = memoryCtx({ subsonic: cfg });
    await expect(subsonic.verify!(ctx)).rejects.toThrow(/Wrong username/);
    const r = await subsonic.search!(ctx, 'q', 5);
    expect(r.tracks[0].sourceTrackId).toBe('s1'); expect(r.albums[0].title).toBe('Al');
    expect((await subsonic.resolveStream!(ctx, r.tracks[0], 'lossless')).uri).toMatch(/^https:\/\/m\.example\/rest\/stream\?.*format=raw/);
    expect((await subsonic.resolveStream!(ctx, r.tracks[0], 'data_saver')).uri).toContain('maxBitRate=96');
  });
});

it('распознаёт ссылки YouTube', () => {
  for (const u of ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1', 'https://youtu.be/dQw4w9WgXcQ', 'dQw4w9WgXcQ']) expect(parseYouTubeId(u)).toBe('dQw4w9WgXcQ');
  expect(parseYouTubeId('https://example.com')).toBeNull();
});
