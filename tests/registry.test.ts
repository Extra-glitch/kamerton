import { writeFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

// Модули устройства в этой проверке не нужны.
vi.mock('@/platform/localMusic', () => ({ searchLocal: vi.fn(), readLocalLyrics: vi.fn() }));
vi.mock('@/platform/oauth', () => ({ spotifyAccessToken: vi.fn() }));

import { ADAPTERS, adapter, CATEGORY_LABEL, DIRECT_SOURCES, playbackLabel, STATE_LABEL } from '@/sources/registry';
import { memoryCtx } from './helpers';

describe('честность источников', () => {
  it('в приложении играют только разрешённые источники', () => {
    expect([...DIRECT_SOURCES].sort()).toEqual(['archive', 'audius', 'jamendo', 'local', 'radio', 'subsonic']);
  });
  it.each(['yandex', 'vk', 'deezer', 'youtube_music', 'bandcamp'])('%s только открывается по ссылке', async (id) => {
    const a = adapter(id)!;
    expect(a.resolveStream).toBeUndefined(); expect(a.search).toBeUndefined();
    expect((await a.status(memoryCtx())).state).toBe('link_only');
    expect(a.externalUrl!({ title: 'Песня', artist: 'Кто-то' })).toMatch(/^https:/);
  });
  it.each(['apple', 'soundcloud', 'tidal'])('%s не притворяется подключённым', async (id) => {
    expect((await adapter(id)!.status(memoryCtx())).state).toBe('not_implemented'); expect(adapter(id)!.resolveStream).toBeUndefined();
  });
  it('Spotify: без звука, без смешивания и без ML', async () => {
    const s = adapter('spotify')!;
    expect(s.resolveStream).toBeUndefined();
    expect(s.capabilities).toMatchObject({ playback: 'external-app', mlAllowed: false, canMixWithOtherSources: false, canCrossfade: false });
    expect((await s.status(memoryCtx())).state).toBe('needs_setup');
  });
  it('YouTube: только видимый плеер без фона', () => {
    expect(adapter('youtube')!.capabilities).toMatchObject({ playback: 'visible-embed', requiresVisiblePlayer: true, canBackground: false });
  });
  it('у каждого источника есть описание и подпись', () => {
    for (const a of ADAPTERS) { expect(a.doc.summary).toBeTruthy(); expect(playbackLabel(a)).toBeTruthy(); }
  });
});

it.runIf(process.env.GENERATE_DOCS)('создаёт документацию источников', async () => {
  const ctx = memoryCtx();
  const out = ['# Источники музыки', '', 'Файл создан автоматически из описаний адаптеров (`npm run docs`).', ''];
  for (const a of ADAPTERS) {
    const st = await a.status(ctx);
    out.push(`## ${a.name}`, '', a.doc.summary, '', `- Категория: ${CATEGORY_LABEL[a.category]}`, `- Воспроизведение: ${playbackLabel(a)}`, `- Состояние без настройки: ${STATE_LABEL[st.state]}`);
    if (a.doc.docsUrl) out.push(`- Документация: ${a.doc.docsUrl}`);
    for (const [title, list] of [['Подключение', a.doc.setup], ['Ограничения', a.doc.limits], ['Не подтверждено', a.doc.unconfirmed]] as const) if (list.length) out.push('', `**${title}**`, '', ...list.map((x) => `- ${x}`));
    out.push('');
  }
  writeFileSync('docs/SOURCES.md', out.join('\n'));
});
