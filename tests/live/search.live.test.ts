// Проверка поиска на НАСТОЯЩИХ ответах сервисов. Запускается только с LIVE=1 (в GitHub Actions),
// потому что среда разработки не имеет доступа к этим сайтам. Ничего не подменяется.
// Ключи YouTube и SoundCloud берутся из секретов репозитория, если владелец их добавил.

import { appendFileSync } from 'node:fs';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('expo-network', () => ({ getNetworkStateAsync: async () => ({ type: 'WIFI' }), NetworkStateType: { CELLULAR: 'CELLULAR' } }));
vi.mock('@/platform/localMusic', () => ({ searchLocal: vi.fn(async () => []), readLocalLyrics: vi.fn() }));
vi.mock('@/platform/oauth', () => ({ spotifyAccessToken: vi.fn(async () => null) }));
vi.mock('@/platform/secureConfig', async () => {
  const keys: Record<string, Record<string, string>> = {};
  if (process.env.YT_API_KEY) keys.youtube = { apiKey: process.env.YT_API_KEY };
  if (process.env.SC_CLIENT_ID && process.env.SC_CLIENT_SECRET) keys.soundcloud = { clientId: process.env.SC_CLIENT_ID, clientSecret: process.env.SC_CLIENT_SECRET };
  return { sourceContext: (await import('../helpers')).memoryCtx(keys) };
});

import * as repo from '@/db/repo';
import { runSearch, setSearchTimeout, useSearch } from '@/search/engine';
import { playBadge } from '@/ui/musicBadge';
import { memoryDb } from '../helpers';

const QUERIES: [string, RegExp][] = [
  ['Моргенштерн', /morgenshtern/i], ['MORGENSHTERN', /morgenshtern/i], ['Дэд Блонд', /dead blonde/i], ['DEAD BLONDE', /dead blonde/i],
  ['Лида', /лида|lida/i], ['Miyagi', /miyagi/i], ['Земфира', /земфира|zemfira/i], ['Кино Группа крови', /кино|kino/i],
  ['The Weeknd', /weeknd/i], ['Billie Eilish', /billie eilish/i], ['Мальчик на девятке', /dead blonde/i], ['Blinding Lights', /weeknd/i],
];

const report: string[] = ['## Живая проверка поиска', '', '| Запрос | Найдено треков | С нужным исполнителем | Первые результаты | Источники |', '|---|---|---|---|---|'];

describe.runIf(process.env.LIVE)('поиск на настоящих API', () => {
  beforeAll(async () => { await repo.initRepo(memoryDb()); setSearchTimeout(15000); });

  it.each(QUERIES)('%s', async (q, artist) => {
    await runSearch(q);
    const s = useSearch.getState();
    const hits = s.tracks.filter((t) => artist.test(t.artist) || artist.test(t.title));
    const top = s.tracks.slice(0, 3).map((t) => `${t.artist} — ${t.title} (${playBadge(t.preferred).label})`).join('; ');
    const runs = s.runs.map((r) => `${r.name}: ${r.state}${r.state === 'ok' || r.state === 'empty' ? ` ${r.matched}/${r.received}` : ''}${r.error ? ` (${r.error})` : ''}`).join(', ');
    console.log(`ПОИСК «${q}» → треков ${s.tracks.length}, нужных ${hits.length}. Варианты: ${s.variants.join(' | ')}\n  Первые: ${top}\n  Источники: ${runs}`);
    report.push(`| ${q} | ${s.tracks.length} | ${hits.length} | ${top.replace(/\|/g, '/')} | ${runs.replace(/\|/g, '/')} |`);
    if (process.env.GITHUB_STEP_SUMMARY && q === QUERIES[QUERIES.length - 1][0]) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report.join('\n') + '\n');
    expect(s.done).toBe(true);
  }, 60000);
});
