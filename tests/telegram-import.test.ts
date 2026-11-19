// Импорт файлов из Telegram: служебные имена, повторная отправка, исправление названия,
// и волна, которая не подменяет интернет-источники файлами с телефона.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/platform/localMusic', () => ({ searchLocal: vi.fn(async () => []), readLocalLyrics: vi.fn(), importAudioFiles: vi.fn(), scanNewFiles: vi.fn() }));
vi.mock('@/platform/oauth', () => ({ spotifyAccessToken: vi.fn(async () => null) }));
vi.mock('@/platform/secureConfig', async () => ({ sourceContext: (await import('./helpers')).memoryCtx() }));
vi.mock('expo-network', () => ({ getNetworkStateAsync: async () => ({ type: 'WIFI' }), NetworkStateType: { CELLULAR: 'CELLULAR' } }));

import type { RemoteTrack } from '@/core/types';
import * as repo from '@/db/repo';
import { fileUri, isOpaqueName } from '@/import/fileNames';
import { trackFromFile } from '@/import/localTrack';
import { setDisabledSources } from '@/sources/registry';
import { wavePool } from '@/services/reco';
import { applyIdentity } from '@/services/importFiles';
import { memoryDb } from './helpers';

describe('имена файлов из Telegram', () => {
  it('служебные имена распознаются', () => {
    for (const n of ['2_5341234123412341234.mp3', '4_6012345678901234567.m4a', '-1_123456789.mp3', 'audio_2026-11-19_23-45-01.ogg', 'FILE_1763590000000.mp3', '1763590000000.mp3', 'a3f9c0de12b4a7e8ff00aa11.mp3'])
      expect(isOpaqueName(n)).toBe(true);
    for (const n of ['Земфира - Искала.mp3', 'MORGENSHTERN - Cadillac (@TgSoundBot).mp3', 'Кино_-_Группа_крови.mp3', '03. Lida - Lyubov.m4a', 'Track of the year.mp3'])
      expect(isOpaqueName(n)).toBe(false);
  });

  it('путь с «#», пробелами и кириллицей превращается в целый адрес, а не обрезается на «#»', () => {
    const path = '/data/user/0/app/cache/Земфира - Искала #2 (@TgSoundBot) 100%.mp3';
    const uri = fileUri(`file://${path}`);
    expect(uri).not.toContain('#');
    expect(uri).not.toContain(' ');
    expect(decodeURIComponent(new URL(uri).pathname)).toBe(path);
    expect(fileUri(path)).toBe(uri);
    expect(fileUri('content://media/external/audio/media/5')).toBe('content://media/external/audio/media/5');
  });

  it('файл без тегов с именем Telegram: «без названия» и просьба указать песню, а не набор цифр', () => {
    const t = trackFromFile('2_5341234123412341234.mp3', 'file:///music/a.mp3', 200, null);
    expect(t.title).toBe('Без названия');
    expect(t.artist).toBe('Неизвестный исполнитель');
    expect(t.extra).toMatchObject({ titleFrom: 'none', needsInfo: true, fileName: '2_5341234123412341234.mp3' });
  });

  it('теги важнее имени файла, имя — запасной вариант', () => {
    const tagged = trackFromFile('2_5341234123412341234.mp3', 'file:///music/b.mp3', 200, { title: 'Cadillac (@TgSoundBot)', artist: 'MORGENSHTERN, Элджей', explicit: 'unknown' });
    expect(tagged).toMatchObject({ title: 'Cadillac', artist: 'MORGENSHTERN, Элджей' });
    expect(tagged.extra).toMatchObject({ titleFrom: 'tags', needsInfo: false });
    const named = trackFromFile('Земфира - Искала.mp3', 'file:///music/c.mp3', 200, null);
    expect(named).toMatchObject({ title: 'Искала', artist: 'Земфира' });
    expect(named.extra).toMatchObject({ titleFrom: 'file', needsInfo: false });
  });
});

describe('название и обложка, которые выбрал пользователь', () => {
  beforeEach(async () => { await repo.initRepo(memoryDb()); });

  it('подставляются в трек и в данные файла, повтор файла их не затирает', async () => {
    const t = trackFromFile('2_5341234123412341234.mp3', 'file:///music/x.mp3', 201, null);
    const id = await repo.upsertRemote(t, { library: true, localPath: 'file:///music/x.mp3' });
    await applyIdentity(id, { title: 'Искала', artist: 'Земфира', album: 'Вендетта', coverUrl: 'https://cdn/cover.jpg', isrc: 'RUA000000001' });
    const v = (await repo.getView(id))!;
    expect(v).toMatchObject({ title: 'Искала', artist: 'Земфира', album: 'Вендетта', coverUrl: 'https://cdn/cover.jpg', isrc: 'RUA000000001' });
    expect(v.sources[0].extra).toMatchObject({ titleFrom: 'user', needsInfo: false });
    expect(v.sources[0]).toMatchObject({ title: 'Искала', coverUrl: 'https://cdn/cover.jpg' });
    expect(v.canonicalKey).toContain('земфира');
    const s = await repo.sourceData(`local:${t.sourceTrackId}`);
    expect(s?.trackId).toBe(id);
  });
});

function view(id: string, sources: Partial<RemoteTrack>[]): never {
  const list = sources.map((s, i) => ({ source: 'audius', sourceTrackId: `${id}${i}`, title: 'x', artist: 'y', explicit: 'unknown', availability: 'full', ...s, id: `${s.source}:${id}${i}`, trackId: id, fetchedAt: 0 }));
  return { id, title: 'x', artist: 'y', canonicalKey: id, tags: [], versionTags: [], explicit: 'unknown', mlRestricted: false, addedAt: 0, sources: list, preferred: list[0], liked: false } as never;
}

describe('волна берёт интернет-источники', () => {
  beforeEach(() => setDisabledSources([]));
  it('файлы с телефона не подмешиваются без разрешения, а песня с обоими источниками играет из интернета', () => {
    const pool = [view('a', [{ source: 'local' }]), view('b', [{ source: 'audius' }]), view('c', [{ source: 'local' }, { source: 'audius' }])];
    const online = wavePool(pool, false);
    expect(online.map((t: any) => t.id)).toEqual(['b', 'c']);
    expect((online[1] as any).preferred.source).toBe('audius');
    expect(wavePool(pool, true).map((t: any) => t.id)).toEqual(['a', 'b', 'c']);
  });
  it('выключенные источники в волну не попадают', () => {
    setDisabledSources(['audius']);
    const pool = [view('b', [{ source: 'audius' }]), view('d', [{ source: 'archive' }])];
    expect(wavePool(pool, false).map((t: any) => t.id)).toEqual(['d']);
  });
});
