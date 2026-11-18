import { caps, DIRECT, emptySearch, type MusicSourceAdapter } from './types';
import { parseLyrics } from '@/core/lrc';
import { readLocalLyrics, searchLocal } from '@/platform/localMusic';

export const local: MusicSourceAdapter = {
  id: 'local', name: 'Файлы на телефоне', category: 'own',
  capabilities: caps({ ...DIRECT, canOffline: true, supportsSearch: true, supportsDiscovery: true, supportsLibraryImport: true, metadata: { isrc: true, explicit: true, genres: true, audioFeatures: true } }),
  doc: {
    summary: 'Ваша музыка на телефоне: MP3, FLAC, Opus, M4A и другие форматы, которые поддерживает Android.',
    limits: ['ISRC, метка цензуры и текст берутся только из тегов файла.', 'Если тегов нет, используется имя файла.'],
    unconfirmed: ['Поддержка отдельных форматов зависит от устройства.'],
    setup: ['Нажмите «Найти музыку на телефоне» и разрешите доступ к аудио.', 'Либо добавьте отдельные файлы вручную.'],
  },
  status: async () => ({ state: 'ready' }),
  async search(_ctx, q, limit) { return { ...emptySearch(), tracks: await searchLocal(q, limit) }; },
  async discover(_ctx, req) { return searchLocal('', req.limit); },
  async resolveStream(_ctx, t) {
    const uri = String(t.extra?.uri ?? '');
    return { uri, quality: t.quality };
  },
  async lyrics(_ctx, t) {
    const text = await readLocalLyrics(t);
    return text ? parseLyrics(text, 'теги файла') : null;
  },
};
