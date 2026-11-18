import type { RemoteTrack } from '@/core/types';
import { archive } from './archive';
import { audius } from './audius';
import { apple, bandcamp, deezer, soundcloud, tidal, vk, yandex, youtubeMusic } from './external';
import { jamendo } from './jamendo';
import { local } from './local';
import { radio } from './radio';
import { spotify } from './spotify';
import { subsonic } from './subsonic';
import type { MusicSourceAdapter, SourceCategory, SourceContext, SourceStatus } from './types';
import { youtube } from './youtube';

/** Чтобы подключить новый источник, достаточно добавить его адаптер в этот список. */
export const ADAPTERS: MusicSourceAdapter[] = [
  local, subsonic, audius, jamendo, archive, radio,
  spotify, youtube, soundcloud, apple, tidal, yandex, vk, deezer, bandcamp, youtubeMusic,
];

const byId = new Map(ADAPTERS.map((a) => [a.id, a]));
export const adapter = (id: string) => byId.get(id);
export const sourceName = (id: string) => byId.get(id)?.name ?? id;

export const DIRECT_SOURCES = new Set(ADAPTERS.filter((a) => a.capabilities.playback === 'direct-stream' && a.resolveStream).map((a) => a.id));
export const DEFAULT_PRIORITY = ['local', 'subsonic', 'audius', 'jamendo', 'archive', 'radio'];

export const CATEGORY_LABEL: Record<SourceCategory, string> = {
  own: 'На этом телефоне', server: 'Ваш сервер', independent: 'Независимые платформы', open: 'Открытые каталоги', radio: 'Интернет-радио', commercial: 'Крупные сервисы',
};

export const STATE_LABEL: Record<SourceStatus['state'], string> = {
  ready: 'Подключён', needs_setup: 'Нужна настройка', link_only: 'Только переход в сервис', not_implemented: 'Пока не подключается',
};

export function playbackLabel(a: MusicSourceAdapter): string {
  switch (a.capabilities.playback) {
    case 'direct-stream': return a.resolveStream ? 'Играет в приложении' : 'Воспроизведение не включено';
    case 'external-app': return 'Играет в своём приложении';
    case 'visible-embed': return 'Только видимый видеоплеер';
    case 'preview-only': return 'Только фрагменты';
    default: return 'Без воспроизведения';
  }
}

export async function readySources(ctx: SourceContext, test: (a: MusicSourceAdapter) => boolean): Promise<MusicSourceAdapter[]> {
  const list = ADAPTERS.filter(test);
  const states = await Promise.all(list.map((a) => a.status(ctx).catch(() => ({ state: 'needs_setup' }) as SourceStatus)));
  return list.filter((_, i) => states[i].state === 'ready');
}

export const isPlayableHere = (t: Pick<RemoteTrack, 'source' | 'availability'>) => DIRECT_SOURCES.has(t.source) && t.availability === 'full';
