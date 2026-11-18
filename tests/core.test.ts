import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readAudioTags } from '@/core/audioTags';
import { chooseSource } from '@/core/choose';
import { activeLine, parseLyrics } from '@/core/lrc';
import { rankCandidates, scoreCandidate } from '@/core/match';
import { md5 } from '@/core/md5';
import { similarity, splitArtists, transliterate } from '@/core/text';
import { canonicalKey, explicitLabel, parseTitle, resolveExplicit } from '@/core/versions';
import { remote, view } from './helpers';

describe('определение версий', () => {
  it.each([
    ['Song (Clean)', ['clean']], ['Song [Radio Edit]', ['radio_edit']], ['Song - Live at Wembley', ['live']], ['Song (Acoustic Version)', ['acoustic']],
    ['Song (Sped Up)', ['sped_up']], ['Песня (ремикс)', ['remix']], ['Песня (кавер)', ['cover']], ['Песня (концертная версия)', []], ['Song - Remastered 2011', ['remaster']],
    ['Song (Karaoke Version)', ['karaoke']], ['Song Remix', ['remix']],
  ])('%s', (title, tags) => {
    if (title.includes('концертная')) expect(parseTitle(title).versionTags).toContain('live');
    else expect(parseTitle(title).versionTags).toEqual(tags);
  });

  it('не считает версией обычные слова в названии', () => {
    for (const t of ['Clean', 'Live Forever', 'Cover Me', 'Clean Bandit', '(I Can’t Get No) Satisfaction']) expect(parseTitle(t).versionTags).toEqual([]);
    expect(parseTitle('(I Can’t Get No) Satisfaction').coreTitle).toBe('i can t get no satisfaction');
  });

  it('uncensored и «без цензуры» не становятся clean', () => {
    expect(parseTitle('Song (Uncensored)').versionTags).toEqual(['explicit_marked']);
    expect(parseTitle('Песня (без цензуры)').versionTags).toEqual(['explicit_marked']);
    expect(parseTitle('Песня (нецензурная версия)').versionTags).toEqual(['explicit_marked']);
    expect(resolveExplicit('unknown', ['explicit_marked'])).toBe('explicit');
  });

  it('feat. уходит из основы названия', () => {
    const p = parseTitle('Song (feat. Someone)');
    expect(p.coreTitle).toBe('song');
    expect(p.featured).toEqual(['Someone']);
    expect(parseTitle('Song feat. Someone').coreTitle).toBe('song');
  });

  it('clean и оригинал получают разные ключи, оригинал с explicit и без отметки один', () => {
    const base = { title: 'Song', artist: 'A' };
    expect(canonicalKey({ ...base, explicit: 'explicit' })).toBe(canonicalKey({ ...base, explicit: 'unknown' }));
    expect(canonicalKey({ ...base, explicit: 'clean' })).not.toBe(canonicalKey({ ...base, explicit: 'explicit' }));
    expect(canonicalKey({ title: 'Song (Clean)', artist: 'A', explicit: 'unknown' })).not.toBe(canonicalKey({ ...base, explicit: 'unknown' }));
  });

  it('честно сообщает о неизвестной версии', () => {
    expect(explicitLabel('unknown')).toBe('Версия не указана источником');
    expect(explicitLabel('clean')).toContain('Цензурированная');
  });
});

describe('сопоставление', () => {
  const q = { title: 'Группа крови', artist: 'Кино', durationSec: 285 };

  it('находит транслитерацию', () => {
    expect(similarity('Кино', 'Kino')).toBeGreaterThan(0.95);
    expect(transliterate('Группа крови')).toBe('gruppa krovi');
    expect(scoreCandidate(q, remote({ title: 'Gruppa Krovi', artist: 'Kino', durationSec: 284 })).status).toBe('matched');
  });

  it.each([['Группа крови (Live)'], ['Группа крови (Remix)'], ['Группа крови (Cover)'], ['Группа крови (Karaoke)']])('не принимает %s за оригинал', (title) => {
    const r = scoreCandidate(q, remote({ title, artist: 'Кино', durationSec: 285 }));
    expect(r.status).toBe('other_version');
    expect(r.score).toBeLessThanOrEqual(0.7);
  });

  it('отдельно отмечает, что нашлась только цензурированная версия', () => {
    expect(scoreCandidate(q, remote({ title: 'Группа крови (Clean)', artist: 'Кино', durationSec: 285 })).status).toBe('clean_only');
    expect(scoreCandidate(q, remote({ title: 'Группа крови', artist: 'Кино', durationSec: 285, explicit: 'clean' })).status).toBe('clean_only');
  });

  it('ISRC сильнее названия, но разная длительность вызывает сомнение', () => {
    const c = remote({ title: 'Blood Type', artist: 'Kino', isrc: 'RU-A12-34-56789', durationSec: 285 });
    expect(scoreCandidate({ ...q, isrc: 'RUA123456789' }, c).status).toBe('matched');
    expect(scoreCandidate({ ...q, isrc: 'RUA123456789' }, { ...c, durationSec: 200 }).status).toBe('doubtful');
  });

  it('другой исполнитель не считается совпадением', () => {
    expect(scoreCandidate(q, remote({ title: 'Группа крови', artist: 'Сплин', durationSec: 285 })).status).not.toBe('matched');
  });

  it('при равенстве выбирает оригинал с пометкой explicit', () => {
    const ranked = rankCandidates({ title: 'Song', artist: 'A', durationSec: 200 }, [
      remote({ title: 'Song', artist: 'A', sourceTrackId: '1' }), remote({ title: 'Song', artist: 'A', sourceTrackId: '2', explicit: 'explicit' }), remote({ title: 'Song', artist: 'A', sourceTrackId: '3', explicit: 'clean' }),
    ]);
    expect(ranked[0].candidate.sourceTrackId).toBe('2');
    expect(ranked[2].candidate.sourceTrackId).toBe('3');
  });

  it('другая версия чужого исполнителя не предлагается, своя идёт первой', () => {
    const ranked = rankCandidates({ title: 'Песня (Remix)', artist: 'Группа' }, [remote({ title: 'Песня', artist: 'Совсем другие', sourceTrackId: 'x' }), remote({ title: 'Песня', artist: 'Группа', sourceTrackId: 'y' })]);
    expect(ranked[0]).toMatchObject({ status: 'other_version', candidate: { sourceTrackId: 'y' } });
    expect(ranked[1].status).toBe('missing');
  });

  it('разделяет исполнителей', () => { expect(splitArtists('A feat. B, C & D')).toEqual(['A', 'B', 'C', 'D']); });
});

describe('выбор источника', () => {
  const st = (id: string, over: object) => ({ ...view(id).preferred!, id, source: id, ...over });
  const opts = { directSources: new Set(['a', 'b', 'c']), priority: ['a', 'b', 'c'], versionFilter: 'original_first' as const };

  it('не подменяет оригинал цензурой даже при более высоком приоритете источника', () => {
    expect(chooseSource([st('a', { explicit: 'clean' }), st('b', { explicit: 'explicit' })], opts)!.id).toBe('b');
  });
  it('полный трек важнее превью', () => {
    expect(chooseSource([st('a', { availability: 'preview', explicit: 'explicit' }), st('b', {})], opts)!.id).toBe('b');
  });
  it('уважает выбор пользователя', () => {
    expect(chooseSource([st('a', {}), st('b', {})], { ...opts, userChoice: 'b' })!.id).toBe('b');
  });
});

describe('LRC', () => {
  const text = '[ar:Кто-то]\n[offset:+100]\n[00:01.00]Первая\n[00:02.50][00:05.00]Вторая\n[00:03.00]Третья';
  it('разбирает и сортирует строки', () => {
    const l = parseLyrics(text, 'тест')!;
    expect(l.synced).toBe(true);
    expect(l.lines.map((x) => x.text)).toEqual(['Первая', 'Вторая', 'Третья', 'Вторая']);
    expect(l.lines[0].timeMs).toBe(900);
    expect(activeLine(l.lines, 2500)).toBe(1);
    expect(activeLine(l.lines, 100)).toBe(-1);
  });
  it('обычный текст остаётся обычным', () => { expect(parseLyrics('Строка\n\nЕщё', 'т')!.synced).toBe(false); });
});

it('md5 совпадает с эталонным', () => {
  for (const s of ['', 'sesame', 'парольc19b2d', 'x'.repeat(200)]) expect(md5(s)).toBe(createHash('md5').update(s).digest('hex'));
});

describe('теги настоящих аудиофайлов (созданы ffmpeg)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tags-'));
  const meta = ['title=Группа крови', 'artist=Кино', 'album=Альбом', 'date=1988', 'genre=Rock', 'track=3', 'ISRC=RUA123456789', 'lyrics=Тёплое место'];
  function make(name: string, codec: string[]) {
    const file = join(dir, name);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', ...meta.flatMap((m) => ['-metadata', m]), ...codec, file]);
    const data = readFileSync(file);
    return readAudioTags(async (o, l) => new Uint8Array(data.subarray(o, o + l)), statSync(file).size);
  }
  it('MP3 / ID3v2', async () => {
    const t = await make('a.mp3', ['-c:a', 'libmp3lame', '-b:a', '128k', '-id3v2_version', '3']);
    expect(t).toMatchObject({ title: 'Группа крови', artist: 'Кино', album: 'Альбом', year: 1988, trackNumber: 3 });
    expect(t.genre).toEqual(['Rock']);
    expect(t.quality?.codec).toBe('MP3');
  });
  it('FLAC', async () => {
    const t = await make('a.flac', ['-c:a', 'flac']);
    expect(t).toMatchObject({ title: 'Группа крови', artist: 'Кино', isrc: 'RUA123456789', lyrics: 'Тёплое место' });
    expect(t.quality?.lossless).toBe(true);
    expect(t.durationSec).toBeCloseTo(2, 0);
  });
  it('Ogg Opus', async () => {
    const t = await make('a.opus', ['-c:a', 'libopus']);
    expect(t).toMatchObject({ title: 'Группа крови', artist: 'Кино' });
    expect(t.quality?.codec).toBe('Opus');
  });
  it('M4A', async () => {
    const t = await make('a.m4a', ['-c:a', 'aac']);
    expect(t).toMatchObject({ title: 'Группа крови', artist: 'Кино', album: 'Альбом', year: 1988 });
    expect(t.durationSec).toBeCloseTo(2, 0);
  });
});
