import { afterEach, describe, expect, it, vi } from 'vitest';
import { isArtistMatch, relevance, RELEVANT } from '@/core/relevance';
import { collectJsonTracks, parsePlaylist, swapArtistTitle } from '@/import/formats';
import { deezer, deezerExplicit, mapDeezerTrack } from '@/sources/deezer';
import { itunesExplicit, mapItunesTrack } from '@/sources/itunes';
import { isSoundCloudLink, mapSoundCloudOembed, soundCloudEmbedUrl } from '@/sources/soundcloud';
import { mapYouTubeOembed, youtube } from '@/sources/youtube';
import { contrast, readableOn } from '@/ui/color';
import { memoryCtx, mockFetch } from './helpers';

afterEach(() => vi.unstubAllGlobals());

// Формы ответов взяты из документации Deezer (developers.deezer.com/api), Apple Search API и oEmbed.
// Живой ответ этих API из среды сборки недоступен, поэтому на телефоне есть отдельная проверка поиска.
const dzTrack = {
  id: 1234567, readable: true, title: 'Cadillac', title_short: 'Cadillac', link: 'https://www.deezer.com/track/1234567', duration: 168, rank: 812345,
  explicit_lyrics: true, explicit_content_lyrics: 1, explicit_content_cover: 2, preview: 'https://cdnt-preview.dzcdn.net/api/1/1/a/b/c/0/abc.mp3',
  artist: { id: 13317425, name: 'MORGENSHTERN', picture_medium: 'https://e-cdns-images.dzcdn.net/images/artist/x/250x250.jpg' },
  album: { id: 168000000, title: 'MILLION DOLLAR: HAPPINESS', cover_medium: 'm.jpg', cover_big: 'b.jpg' }, type: 'track',
};

describe('Deezer', () => {
  it('разбирает трек как фрагмент с пометкой Explicit', () => {
    expect(mapDeezerTrack(dzTrack)).toMatchObject({ source: 'deezer', sourceTrackId: '1234567', title: 'Cadillac', artist: 'MORGENSHTERN', artistId: '13317425', availability: 'preview', explicit: 'explicit', coverUrl: 'b.jpg', canOffline: false, durationSec: 168 });
  });
  it('коды цензуры', () => {
    expect(deezerExplicit({ explicit_content_lyrics: 3 })).toBe('clean');
    expect(deezerExplicit({ explicit_content_lyrics: 0 })).toBe('not_explicit');
    expect(deezerExplicit({ explicit_content_lyrics: 4 })).toBe('explicit');
    expect(deezerExplicit({ explicit_content_lyrics: 2, explicit_lyrics: false })).toBe('unknown');
  });
  it('недоступный в регионе трек не выдаётся за фрагмент', () => {
    expect(mapDeezerTrack({ ...dzTrack, readable: false }).availability).toBe('region_blocked');
    expect(mapDeezerTrack({ ...dzTrack, preview: '' }).availability).toBe('external_only');
  });
  it('поиск: треки, исполнители и альбомы', async () => {
    mockFetch([
      [/search\/artist/, { data: [{ id: 13317425, name: 'MORGENSHTERN', picture_big: 'p.jpg', nb_fan: 900000 }] }],
      [/search\/album/, { data: [{ id: 1, title: 'LAST ONE', artist: { name: 'MORGENSHTERN' }, cover_big: 'c.jpg', release_date: '2021-12-31', record_type: 'album' }] }],
      [/\/search\?/, { data: [dzTrack], total: 1 }],
    ]);
    const r = await deezer.search!(memoryCtx(), 'morgenshtern', 10);
    expect(r.tracks).toHaveLength(1);
    expect(r.artists[0]).toMatchObject({ name: 'MORGENSHTERN', imageUrl: 'p.jpg', followers: 900000 });
    expect(r.albums[0]).toMatchObject({ title: 'LAST ONE', releaseDate: '2021-12-31', kind: 'album', year: 2021 });
  });
  it('ошибка квоты становится понятным сообщением', async () => {
    mockFetch([[/deezer/, { error: { type: 'Exception', message: 'Quota limit exceeded', code: 4 } }]]);
    await expect(deezer.search!(memoryCtx(), 'x', 5)).rejects.toThrow(/слишком много запросов/);
  });
  it('фрагмент отдаётся только как фрагмент', async () => {
    const s = await deezer.resolveStream!(memoryCtx(), { ...mapDeezerTrack(dzTrack), id: 'deezer:1', trackId: 't', fetchedAt: 0 } as never, 'normal');
    expect(s.uri).toBe(dzTrack.preview);
  });
});

describe('Apple (каталог)', () => {
  it('разбирает песню и увеличивает обложку', () => {
    const t = mapItunesTrack({ kind: 'song', trackId: 9, artistId: 7, trackName: 'Мальчик на девятке', artistName: 'DEAD BLONDE', collectionName: 'Мальчик на девятке', trackTimeMillis: 145000, trackExplicitness: 'notExplicit', primaryGenreName: 'Поп', releaseDate: '2020-11-06T12:00:00Z', artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/x/100x100bb.jpg', trackViewUrl: 'https://music.apple.com/ru/album/1?i=9' });
    expect(t).toMatchObject({ source: 'itunes', availability: 'subscription_required', explicit: 'not_explicit', durationSec: 145, year: 2020, coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/x/600x600bb.jpg' });
    expect(itunesExplicit('cleaned')).toBe('clean');
  });
});

describe('SoundCloud и YouTube по ссылке', () => {
  it('SoundCloud: oEmbed превращается в трек со встроенным плеером', () => {
    expect(isSoundCloudLink('https://soundcloud.com/lida/track?si=1')).toBe(true);
    expect(isSoundCloudLink('https://example.com/soundcloud.com')).toBe(false);
    const t = mapSoundCloudOembed('https://soundcloud.com/lida/track?si=1', { title: 'Любовь by Лида', author_name: 'Лида', thumbnail_url: 'th.jpg' });
    expect(t).toMatchObject({ source: 'soundcloud', title: 'Любовь', artist: 'Лида', availability: 'full', canOffline: false, sourceTrackId: 'https://soundcloud.com/lida/track' });
    expect(soundCloudEmbedUrl('https://soundcloud.com/a/b')).toContain('w.soundcloud.com/player/?url=https%3A%2F%2Fsoundcloud.com%2Fa%2Fb');
  });
  it('YouTube: «Исполнитель - Песня (Official Video)»', () => {
    expect(mapYouTubeOembed('abcdefghijk', { title: 'MORGENSHTERN - Cadillac (Official Video, 2020)', author_name: 'MORGENSHTERN' })).toMatchObject({ title: 'Cadillac', artist: 'MORGENSHTERN', source: 'youtube', availability: 'full' });
    expect(youtube.canHandleLink!('https://youtu.be/abcdefghijk')).toBe(true);
    expect(youtube.canHandleLink!('https://example.com/abcdefghijk')).toBe(false);
  });
  it('YouTube без VPN: честная ошибка', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Network request failed'); }));
    await expect(youtube.resolveLink!(memoryCtx(), 'https://youtu.be/abcdefghijk')).rejects.toThrow(/VPN/);
  });
});

describe('релевантность поиска', () => {
  it('случайные совпадения отсекаются', () => {
    expect(relevance('morgenshtern', { title: 'Cadillac', artist: 'MORGENSHTERN' })).toBeGreaterThanOrEqual(RELEVANT);
    expect(relevance('Моргенштерн', { title: 'Cadillac', artist: 'MORGENSHTERN' })).toBeGreaterThanOrEqual(0.8);
    expect(relevance('dead blonde', { title: 'Мальчик на девятке', artist: 'DEAD BLONDE' })).toBeGreaterThanOrEqual(RELEVANT);
    expect(relevance('лида', { title: 'Любовь', artist: 'Лида' })).toBeGreaterThanOrEqual(RELEVANT);
    expect(relevance('dead blonde', { title: 'Blonde Ambition', artist: 'Mike Fields' })).toBeLessThan(RELEVANT);
    expect(relevance('morgenshtern', { title: 'Morning Sun', artist: 'Free Sounds' })).toBeLessThan(RELEVANT);
  });
  it('исполнитель распознаётся по имени', () => {
    expect(isArtistMatch('dead blonde', 'DEAD BLONDE')).toBe(true);
    expect(isArtistMatch('lida', 'Лида')).toBe(true);
    expect(isArtistMatch('lida', 'Lidia Kowalska')).toBe(false);
  });
});

describe('перенос из Яндекс Музыки', () => {
  it('текст, скопированный со страницы плейлиста', () => {
    const copied = 'Мне нравится\n734 трека\nСлушать\nCadillac\nMORGENSHTERN, Элджей\n2:48\nE\nМальчик на девятке\nDEAD BLONDE\n2:25\nЛюбовь\nЛида\n3:01';
    expect(parsePlaylist('x.txt', copied).map((i) => [i.artist, i.title, i.durationSec])).toEqual([['MORGENSHTERN, Элджей', 'Cadillac', 168], ['DEAD BLONDE', 'Мальчик на девятке', 145], ['Лида', 'Любовь', 181]]);
  });
  it('страница с колонкой альбома и версией песни', () => {
    const copied = 'Плейлист\nПесня А\nАртист А\nАльбом А\n3:00\nПесня Б\nRemix\nАртист Б\nАльбом Б\n2:10\nПесня В\nАртист В\nАльбом В\n4:05';
    expect(parsePlaylist('x.txt', copied).map((i) => [i.artist, i.title, i.album])).toEqual([['Артист А', 'Песня А', 'Альбом А'], ['Артист Б', 'Песня Б (Remix)', 'Альбом Б'], ['Артист В', 'Песня В', 'Альбом В']]);
  });
  it('обычный список «Исполнитель - Песня» не ломается', () => {
    expect(parsePlaylist('x.txt', 'Кино - Группа крови\nЗемфира - Искала').map((i) => i.artist)).toEqual(['Кино', 'Земфира']);
  });
  it('архив данных любой формы', () => {
    const archive = { music: { likes: [{ track: { title: 'Cadillac', artists: [{ name: 'MORGENSHTERN' }, { name: 'Элджей' }], albums: [{ title: 'X' }], durationMs: 168000 } }], other: { foo: 1 } } };
    expect(collectJsonTracks(archive)).toEqual([expect.objectContaining({ title: 'Cadillac', artist: 'MORGENSHTERN, Элджей' })]);
    expect(parsePlaylist('archive.json', JSON.stringify(archive))).toHaveLength(1);
  });
  it('CSV из TuneMyMusic', () => {
    const csv = 'Track name,Artist name,Album,Playlist name,Type,ISRC\nCadillac,MORGENSHTERN,MILLION DOLLAR,Мне нравится,Favorite,RUA1D2000001\n';
    expect(parsePlaylist('export.csv', csv)[0]).toMatchObject({ title: 'Cadillac', artist: 'MORGENSHTERN', isrc: 'RUA1D2000001' });
  });
  it('столбцы можно поменять местами', () => {
    expect(swapArtistTitle([{ title: 'Лида', artist: 'Любовь' }])).toEqual([{ title: 'Любовь', artist: 'Лида' }]);
  });
});

describe('цвета обложки', () => {
  it('акцент всегда читаем на фоне', () => {
    for (const c of ['#203040', '#0a0a40', '#ff0000', '#ffff00']) {
      expect(contrast(readableOn(c, '#140F1F'), '#140F1F')).toBeGreaterThanOrEqual(4.5);
      expect(contrast(readableOn(c, '#F1ECF7'), '#F1ECF7')).toBeGreaterThanOrEqual(4.5);
    }
  });
});
