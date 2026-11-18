import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayRecord } from '@/core/types';
import * as repo from '@/db/repo';
import { exportPlaylist, parsePlaylist } from '@/import/formats';
import { matchAll, summarize } from '@/import/pipeline';
import { PlayerController, type AudioDriver, type DriverStatus, type DriverTrack } from '@/player/controller';
import { PlayQueue } from '@/player/queue';
import { bucketOf, buildProfile, buildWave, poolStats, seededRng, similarTo, surprise } from '@/reco/engine';
import { analyzeLibrary, applySmartRule, buildPortrait, buildTasteCard, compareTaste, djSequence, parseTasteCard } from '@/reco/extras';
import { memoryDb, remote, view } from './helpers';

const signals = { plays: [] as PlayRecord[], reactions: [], saves: [], seedTags: [] as string[], seedArtists: [] as string[] };
const play = (trackId: string, over: Partial<PlayRecord> = {}): PlayRecord => ({ trackId, sourceTrackId: `audius:${trackId}`, startedAt: Date.now() - 5 * 86_400_000, listenedMs: 190_000, durationMs: 200_000, completed: true, skipped: false, context: '', ...over });

describe('база и объединение источников', () => {
  beforeEach(async () => { await repo.initRepo(memoryDb()); repo.setSourceChoice({ directSources: new Set(['audius', 'jamendo']), priority: ['audius', 'jamendo'], versionFilter: 'original_first' }); });

  it('миграция повторно безопасна', async () => { await repo.initRepo(repo.rawDb()); expect(await repo.listPlaylists()).toEqual([]); });

  it('одна песня из разных сервисов становится одной записью с двумя источниками', async () => {
    const a = await repo.upsertRemote(remote({ title: 'Song', artist: 'Кино', source: 'audius', sourceTrackId: '1' }));
    const b = await repo.upsertRemote(remote({ title: 'SONG', artist: 'кино', source: 'jamendo', sourceTrackId: '2', durationSec: 201, explicit: 'explicit' }));
    expect(b).toBe(a);
    const v = (await repo.getView(a))!;
    expect(v.sources.map((s) => s.source).sort()).toEqual(['audius', 'jamendo']);
    expect(v.preferred!.source).toBe('jamendo'); // оригинал с явной пометкой важнее приоритета
  });

  it('оригинал, clean, ремикс и концерт не сливаются', async () => {
    const ids = await repo.upsertMany([remote({ title: 'S', artist: 'A', sourceTrackId: '1' }), remote({ title: 'S (Clean)', artist: 'A', sourceTrackId: '2' }), remote({ title: 'S (Remix)', artist: 'A', sourceTrackId: '3' }), remote({ title: 'S (Live)', artist: 'A', sourceTrackId: '4' })]);
    expect(new Set(ids).size).toBe(4);
  });

  it('разная длительность разводит одноимённые записи', async () => {
    const a = await repo.upsertRemote(remote({ title: 'Intro', artist: 'A', sourceTrackId: '1', durationSec: 60 }));
    expect(await repo.upsertRemote(remote({ title: 'Intro', artist: 'A', sourceTrackId: '2', durationSec: 200 }))).not.toBe(a);
  });

  it('данные источника с запретом ML не попадают в признаки', async () => {
    const id = await repo.upsertRemote(remote({ title: 'S', artist: 'A', source: 'spotify', sourceTrackId: 'x', tags: ['rock'], bpm: 100, availability: 'external_only' }), { mlAllowed: false });
    expect(await repo.getView(id)).toMatchObject({ mlRestricted: true, tags: [] });
    expect((await repo.getView(id))!.bpm).toBeUndefined();
  });

  it('лайк и дизлайк исключают друг друга, плейлист хранит порядок и пропажи', async () => {
    const id = await repo.upsertRemote(remote({ title: 'S', artist: 'A' }));
    await repo.setReaction(id, 'like', true); await repo.setReaction(id, 'dislike', true);
    expect(await repo.trackReactions(id)).toEqual(['dislike']);
    const p = await repo.createPlaylist({ name: 'P', imported: true });
    await repo.addPlaylistItems(p, [{ trackId: id, status: 'matched', rawTitle: 'S', rawArtist: 'A' }, { status: 'missing', rawTitle: 'Нет', rawArtist: 'B', originalPosition: 1 }]);
    const it = await repo.getPlaylistItems(p);
    await repo.movePlaylistItem(p, it[1].id, -1);
    expect((await repo.getPlaylistItems(p)).map((x) => x.rawTitle)).toEqual(['Нет', 'S']);
    expect((await repo.getPlaylistItems(p))[0]).toMatchObject({ status: 'missing', originalPosition: 1 });
  });

  it('параллельные ответы источников не конфликтуют в транзакциях', async () => {
    const batch = (n: number) => repo.upsertMany(Array.from({ length: 5 }, (_, i) => remote({ title: `S${n}-${i}`, artist: 'A', sourceTrackId: `${n}-${i}` })));
    expect((await Promise.all([batch(1), batch(2), batch(3)])).flat()).toHaveLength(15);
  });

  it('удаление данных очищает всё', async () => {
    await repo.upsertRemote(remote({ title: 'S', artist: 'A' })); await repo.kvSet('x', 1); await repo.deleteAllData();
    expect(await repo.libraryTrackIds()).toEqual([]); expect(await repo.kvGet('x', 0)).toBe(0);
  });
});

describe('форматы импорта', () => {
  it('CSV с заголовками Exportify', () => {
    const r = parsePlaylist('a.csv', 'Track Name,Artist Name(s),Album Name,Track Duration (ms),ISRC\n"Song, part 1",Кино,Альбом,200000,RUA1\n');
    expect(r[0]).toMatchObject({ title: 'Song, part 1', artist: 'Кино', album: 'Альбом', durationSec: 200, isrc: 'RUA1', position: 0 });
  });
  it('M3U, XSPF, JSON и текст', () => {
    expect(parsePlaylist('a.m3u8', '#EXTM3U\n#EXTINF:123,Кино - Группа крови\nfile.mp3\nМузыка/Сплин - Орбит.mp3')).toMatchObject([{ artist: 'Кино', title: 'Группа крови', durationSec: 123 }, { artist: 'Сплин', title: 'Орбит' }]);
    expect(parsePlaylist('a.json', JSON.stringify({ tracks: [{ name: 'T', artists: [{ name: 'A' }], duration_ms: 1000, external_ids: { isrc: 'I' } }] }))[0]).toMatchObject({ title: 'T', artist: 'A', durationSec: 1, isrc: 'I' });
    expect(parsePlaylist('t.txt', '1. Кино - Группа крови\n- Сплин — Орбит\nПросто название')).toMatchObject([{ artist: 'Кино' }, { artist: 'Сплин', title: 'Орбит' }, { artist: '', title: 'Просто название' }]);
  });
  it.each(['csv', 'json', 'xspf', 'm3u8'] as const)('экспорт %s читается обратно', (f) => {
    const items = [{ title: 'A & "B", C', artist: 'Кино', album: 'X', durationSec: 100, isrc: f === 'm3u8' || f === 'xspf' ? undefined : 'I' }];
    expect(parsePlaylist(`p.${f}`, exportPlaylist('Тест', items, f))[0]).toMatchObject({ title: items[0].title, artist: 'Кино', durationSec: 100 });
  });
});

describe('конвейер импорта', () => {
  const search = async (q: string) => q.includes('Кино')
    ? [remote({ title: 'Группа крови (Live)', artist: 'Кино', sourceTrackId: 'l', durationSec: 300 }), remote({ title: 'Gruppa Krovi', artist: 'Kino', sourceTrackId: 'o', durationSec: 285, isrc: 'RUA1' })]
    : q.includes('Clean') ? [remote({ title: 'Song (Clean)', artist: 'Clean', sourceTrackId: 'c' })] : [];
  const broken = async () => { throw new Error('сеть'); };

  it('находит оригинал, не теряет ненайденное, переживает сбой источника', async () => {
    const mb = { byIsrc: vi.fn(async () => []), search: vi.fn(async () => [{ mbid: 'm1', title: 'Группа крови', artist: 'Кино', lengthSec: 285, isrcs: ['RUA1'], tags: ['rock'], score: 100, youtubeIds: [] }]) };
    const progress: number[] = [];
    const rows = await matchAll(parsePlaylist('t.txt', 'Кино - Группа крови\nClean - Song\nНикто - Ничего'), { searchers: [search, broken], musicBrainz: mb, onProgress: (d) => progress.push(d) });
    expect(rows[0]).toMatchObject({ status: 'matched', best: { sourceTrackId: 'o' } });
    expect(rows[0].notes[0]).toBe('совпал ISRC');
    expect(rows[1].status).toBe('clean_only');
    expect(rows[2]).toMatchObject({ status: 'missing', item: { position: 2, title: 'Ничего' } }); expect(rows[2].best).toBeUndefined();
    expect(summarize(rows)).toEqual({ matched: 1, doubtful: 1, missing: 1 }); expect(progress).toHaveLength(3);
  });
  it('без исполнителя совпадение остаётся сомнительным', async () => {
    const rows = await matchAll([{ position: 0, title: 'Gruppa Krovi', artist: '' }], { searchers: [async () => [remote({ title: 'Gruppa Krovi', artist: 'Kino' })]] });
    expect(rows[0].status).not.toBe('matched');
  });
});

describe('рекомендации', () => {
  const liked = Array.from({ length: 4 }, (_, i) => view(`l${i}`, { artist: 'Любимый', tags: ['shoegaze'], year: 1994 }));
  const pool = [
    ...Array.from({ length: 6 }, (_, i) => view(`s${i}`, { artist: `Похожий ${i}`, tags: ['shoegaze'], popularity: 100 + i })),
    ...Array.from({ length: 6 }, (_, i) => view(`o${i}`, { artist: `Чужой ${i}`, tags: ['polka'], popularity: 1000 + i })), ...liked,
  ];
  const map = new Map(pool.map((t) => [t.id, t]));
  const profile = buildProfile({ ...signals, plays: liked.map((t) => play(t.id)), reactions: [{ trackId: 'l0', kind: 'like', at: Date.now() }] as never }, map);
  const base = { bandit: {}, versionFilter: 'original_first' as const, rng: seededRng(5) };

  it('трек из импортированного плейлиста остаётся новым', () => {
    const t = view('imp', { artist: 'Любимый', tags: ['shoegaze'] });
    const m = new Map([...map, ['imp', t]]);
    const p = buildProfile({ ...signals, saves: [{ trackId: 'imp', imported: true, at: Date.now() }] }, m);
    expect(p.playedTracks.has('imp')).toBe(false);
    expect(bucketOf(t, p, poolStats([]))).toBe('new_artist');
  });
  it('похожее выше чужого, и каждая рекомендация объяснена', () => {
    const w = buildWave(pool, profile, { ...base, count: 5, discovery: 0.5, cooldownHours: 1 });
    expect(w.length).toBe(5);
    expect(w.every((r) => r.reason.length > 5)).toBe(true);
    expect(w.filter((r) => r.trackId.startsWith('s')).length).toBeGreaterThan(w.filter((r) => r.trackId.startsWith('o')).length);
  });
  it('настройка открытий меняет долю знакомого', () => {
    const share = (d: number) => { let n = 0; for (let i = 1; i < 30; i++) n += buildWave(pool, profile, { ...base, rng: seededRng(i), count: 6, discovery: d, cooldownHours: 0 }).filter((r) => r.bucket === 'familiar').length; return n; };
    expect(share(0)).toBeGreaterThan(share(1));
  });
  it('антиповтор и скрытые треки', () => {
    const hidden = buildProfile({ ...signals, reactions: [{ trackId: 's0', kind: 'hide', at: Date.now() }] as never }, map);
    const w = buildWave(pool, hidden, { ...base, count: 16, discovery: 1, exclude: new Set(['s1']) });
    expect(w.map((r) => r.trackId)).not.toContain('s0'); expect(w.map((r) => r.trackId)).not.toContain('s1');
    expect(new Set(w.map((r) => r.trackId)).size).toBe(w.length);
    const artists = w.map((r) => map.get(r.trackId)!.artist);
    artists.forEach((a, i) => { if (i) expect(a).not.toBe(artists[i - 1]); });
  });
  it('только что звучавшее не возвращается, два дизлайка убирают исполнителя', () => {
    const recent = buildProfile({ ...signals, plays: [play('s0', { startedAt: Date.now() - 3_600_000 })] }, map);
    expect(buildWave(pool, recent, { ...base, count: 16, discovery: 0.2 }).map((r) => r.trackId)).not.toContain('s0');
    const ban = buildProfile({ ...signals, reactions: [{ trackId: 'l0', kind: 'dislike', at: 1 }, { trackId: 'l1', kind: 'dislike', at: 1 }] as never }, map);
    expect(ban.bannedArtists.has('любимый')).toBe(true);
  });
  it('превью и живой эфир не попадают в волну', () => {
    const preview = view('p', { sources: [], preferred: { ...view('p').preferred!, availability: 'preview' } });
    const live = view('r', { preferred: { ...view('r').preferred!, isLive: true } });
    expect(buildWave([preview, live], profile, { ...base, count: 2, discovery: 1 })).toEqual([]);
  });
  it('цензурированная версия не вытесняет оригинал', () => {
    const c = view('c', { artist: 'Любимый 2', tags: ['shoegaze'], title: 'X (Clean)', preferred: { ...view('c').preferred!, title: 'X (Clean)', explicit: 'clean' } });
    const o = view('n', { artist: 'Любимый 3', tags: ['shoegaze'] });
    expect(buildWave([c, o], profile, { ...base, count: 2, discovery: 0.5, onlyBuckets: ['new_artist'] })[0].trackId).toBe('n');
  });
  it('«Удиви меня» даёт только неслышанных исполнителей', () => {
    const r = surprise(pool, profile, base, 5);
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((x) => !map.get(x.trackId)!.artist.startsWith('Любимый'))).toBe(true);
  });
  it('похожие объясняются, радио расширяет круг', () => {
    const seed = view('seed', { artist: 'Любимый', tags: ['shoegaze'] });
    const near = similarTo(seed, pool, profile, { radius: 0 });
    expect(near[0].reason).toBeTruthy();
    const wide = similarTo(seed, pool, profile, { radius: 1.5 });
    expect(wide.filter((x) => x.track.artist === 'Любимый').length).toBeLessThanOrEqual(2);
  });
  it('DJ связывает близкие треки и разгоняет темп', () => {
    const list = [view('a', { tags: ['x'], bpm: 90 }), view('b', { tags: ['y'], bpm: 150 }), view('c', { tags: ['x'], bpm: 92 }), view('d', { tags: ['y'], bpm: 148 })];
    const s = djSequence(list, 'smooth');
    expect(s.map((x) => x.track.id).slice(0, 2)).toEqual(['a', 'c']); expect(s[1].note).toContain('x');
    expect(djSequence(list, 'rise').map((x) => x.track.bpm)).toEqual([90, 92, 148, 150]);
    expect(djSequence(list, 'contrast')[1].track.tags).toEqual(['y']);
  });
  it('портрет считает время и открытия', () => {
    const p = buildPortrait([play('l0'), play('l1'), play('s0', { skipped: true, completed: false, listenedMs: 2000 })], map);
    expect(p.plays).toBe(2); expect(p.artists).toBe(1); expect(p.discoveries).toBe(1); expect(p.topArtists[0].name).toBe('Любимый'); expect(p.decades[0].decade).toBe(1990);
  });
  it('карточка вкуса: общие лайки и обмен', () => {
    const card = parseTasteCard(JSON.stringify(buildTasteCard('Я', liked, profile)));
    const r = compareTaste(card, liked.slice(0, 2).map((t) => ({ ...t, canonicalKey: 'любимый|track l0|' })), pool, profile);
    expect(card.likes).toHaveLength(4); expect(r.commonTags).toContain('shoegaze'); expect(r.forBoth.length).toBeGreaterThan(0);
    expect(() => parseTasteCard('{}')).toThrow(/карточка/);
  });
  it('очистка находит дубликаты и пропажи, умный плейлист фильтрует', () => {
    const item = (id: string, t?: string, status: never = 'matched' as never) => ({ id, playlistId: 'p', position: 0, trackId: t, status, rawTitle: 'S', rawArtist: 'A', addedAt: 0 });
    const r = analyzeLibrary([item('1', 'l0'), item('2', 'l0'), item('3', undefined, 'missing' as never)], map);
    expect(r.duplicatesInPlaylist[0].items).toHaveLength(2); expect(r.missing).toHaveLength(1);
    expect(applySmartRule({ kind: 'decade', value: '1990' }, pool, profile).map((t) => t.id)).toEqual(['l0', 'l1', 'l2', 'l3']);
  });
});

describe('очередь', () => {
  const items = ['a', 'b', 'c', 'd'].map((x) => ({ qid: x, trackId: x, sourceTrackId: x }));
  it('перемешивание сохраняет текущий трек и возвращает порядок', () => {
    const q = new PlayQueue(seededRng(3)); q.set(items, 1); q.setShuffle(true);
    expect(q.current!.qid).toBe('b'); expect(q.items).toHaveLength(4); q.setShuffle(false);
    expect(q.items.map((i) => i.qid)).toEqual(['a', 'b', 'c', 'd']); expect(q.index).toBe(1);
  });
  it('повтор, вставка, удаление, перенос', () => {
    const q = new PlayQueue(); q.set(items, 3);
    expect(q.peekNext(false)).toBeNull(); q.cycleRepeat(); expect(q.peekNext(false)!.qid).toBe('a'); q.cycleRepeat();
    expect(q.peekNext(false)!.qid).toBe('d'); expect(q.peekNext(true)!.qid).toBe('a');
    q.jump('a'); q.insertNext({ qid: 'n', trackId: 'n', sourceTrackId: 'n' }); expect(q.upcoming[0].qid).toBe('n');
    q.move('d', -2); q.remove('b'); expect(q.items.map((i) => i.qid)).toEqual(['a', 'n', 'd', 'c']);
  });
});

function fakeDriver() {
  const d = {
    native: [] as string[], idx: 0, playing: false, vol: 1, loop: 'none', now: null as any,
    status: (_: DriverStatus) => undefined as void, change: (_a: number, _b: number) => undefined as void, err: (_: string) => undefined as void,
    load(t: DriverTrack[], i: number) { d.native = t.map((x) => x.key); d.idx = i; }, append(t: DriverTrack) { d.native.push(t.key); }, removeAt(i: number) { d.native.splice(i, 1); },
    skipTo(i: number) { d.idx = i; }, play() { d.playing = true; }, pause() { d.playing = false; }, async seek() {}, setVolume(v: number) { d.vol = v; }, setLoop(m: string) { d.loop = m; }, setNowPlaying(n: unknown) { d.now = n; },
    onStatus(c: any) { d.status = c; }, onTrackChange(c: any) { d.change = c; }, onError(c: any) { d.err = c; },
  };
  return d;
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('контроллер плеера', () => {
  const tracks = Array.from({ length: 30 }, (_, i) => view(`t${i}`));
  const views = new Map(tracks.map((t) => [t.id, t]));
  function setup(refill?: any) {
    const driver = fakeDriver(); const plays: PlayRecord[] = [];
    const c = new PlayerController({ driver: driver as unknown as AudioDriver, getViews: async (ids) => ids.map((i) => views.get(i)!).filter(Boolean), resolve: async (s) => ({ uri: `u:${s.id}` }), recordPlay: async (p) => { plays.push(p); }, saveState: async () => undefined, refill });
    return { c, driver, plays };
  }
  const list = (n: number) => tracks.slice(0, n).map((t) => ({ trackId: t.id }));
  const st = (o: Partial<DriverStatus>): DriverStatus => ({ index: 0, positionSec: 0, durationSec: 200, playing: true, buffering: false, loaded: true, didFinish: false, ...o });

  it('грузит окно и показывает трек на экране блокировки', async () => {
    const { c, driver } = setup(); await c.playList(list(20), 2, 'test');
    expect(driver.native).toHaveLength(12); expect(driver.playing).toBe(true); expect(driver.now.title).toBe('Track t2'); expect(c.state.current!.id).toBe('t2');
  });
  it('пропуск пишется в историю как пропуск, только реальное время', async () => {
    const { c, driver, plays } = setup(); await c.playList(list(3));
    for (const p of [1, 2, 3, 4, 150]) driver.status(st({ positionSec: p })); // рывок на 150 — перемотка
    await c.next(true); await tick();
    expect(plays[0]).toMatchObject({ trackId: 't0', skipped: true, completed: false }); expect(plays[0].listenedMs).toBe(4000);
    expect(driver.idx).toBe(1);
  });
  it('автоматический переход (в том числе с экрана блокировки) обновляет очередь', async () => {
    const { c, driver, plays } = setup(); await c.playList(list(3));
    for (let p = 2; p <= 198; p += 2) driver.status(st({ positionSec: p }));
    driver.change(0, 1); await tick(); await tick();
    expect(c.state.current!.id).toBe('t1'); expect(plays[0]).toMatchObject({ completed: true, skipped: false }); expect(driver.now.title).toBe('Track t1');
  });
  it('окно подгружается по мере движения', async () => {
    const { c, driver } = setup(); await c.playList(list(25));
    for (let i = 1; i <= 8; i++) { driver.change(i - 1, i); await tick(); await tick(); }
    expect(driver.native.length).toBeGreaterThan(12); expect(new Set(driver.native).size).toBe(driver.native.length);
  });
  it('волна пополняется сама', async () => {
    const refill = vi.fn(async () => [{ qid: 'x', trackId: 't9', sourceTrackId: 'audius:t9' }]);
    const { c } = setup(refill); await c.playList(list(2), 0, 'wave'); await tick(); await tick();
    expect(refill).toHaveBeenCalledWith('wave', expect.anything()); expect(c.state.queue.map((q) => q.trackId)).toContain('t9');
  });
  it('изменение очереди не перезапускает текущий трек', async () => {
    const { c, driver } = setup(); await c.playList(list(4)); const first = driver.native[0];
    await c.playNext('t9'); expect(driver.native[0]).toBe(first); expect(c.state.queue[1].trackId).toBe('t9'); expect(driver.native[1]).toBe(c.state.queue[1].qid);
    await c.setShuffle(true); expect(driver.native[0]).toBe(first);
  });
  it('повтор трека настраивается нативно, таймер сна останавливает', async () => {
    vi.useFakeTimers(); const { c, driver } = setup(); await c.playList(list(2)); c.cycleRepeat(); c.cycleRepeat(); expect(driver.loop).toBe('single');
    c.setSleepTimer(1); vi.advanceTimersByTime(60_000); expect(driver.playing).toBe(false); vi.useRealTimers();
  });
  it('ошибка потока показывается и переходит дальше, но не перебирает всё без конца', async () => {
    const { c, driver } = setup(); await c.playList(list(6));
    driver.err('нет сети'); await tick(); await tick(); expect(c.state.index).toBe(1); expect(c.state.error).toContain('нет сети');
    driver.err('нет сети'); await tick(); await tick(); driver.err('нет сети'); await tick(); await tick(); expect(c.state.index).toBe(2);
  });
  it('громкость пользователя сочетается с плавным переходом', async () => {
    const { c, driver } = setup(); await c.playList(list(2));
    c.setUserVolume(0.5); expect(driver.vol).toBe(0.5); expect(c.state.volume).toBe(0.5);
    c.setFade(true); driver.status(st({ positionSec: 198, durationSec: 200 })); expect(driver.vol).toBeCloseTo(0.25, 2);
    c.setFade(false); expect(driver.vol).toBe(0.5);
  });
  it('после ошибки плеер загружается заново', async () => {
    const { c, driver } = setup(); await c.playList(list(3)); const load = vi.spyOn(driver, 'load');
    driver.err('сбой'); await tick(); await tick(); expect(load).toHaveBeenCalledTimes(1); expect(driver.native[0]).toBe(c.state.queue[1].qid);
  });
  it('восстановление не включает звук само', async () => {
    const a = setup(); await a.c.playList(list(3)); a.driver.status(st({ positionSec: 42 }));
    let saved: any; const b = fakeDriver();
    const c2 = new PlayerController({ driver: b as unknown as AudioDriver, getViews: async (ids) => ids.map((i) => views.get(i)!), resolve: async (s) => ({ uri: s.id }), recordPlay: async () => undefined, saveState: async (s) => { saved = s; } });
    saved = { queue: a.c.queue.snapshot(), positionSec: 42, context: 'x' }; await c2.restore(saved);
    expect(c2.state.current!.id).toBe('t0'); expect(b.playing).toBe(false); expect(c2.state.positionSec).toBe(42);
  });
});
