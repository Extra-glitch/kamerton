import type { RemoteTrack } from '@/core/types';
import { archive } from './archive';
import { audius } from './audius';
import { deezer } from './deezer';
import { apple, bandcamp, tidal, vk, yandex, youtubeMusic, zvuk } from './external';
import { itunes } from './itunes';
import { soundcloud } from './soundcloud';
import { jamendo } from './jamendo';
import { local } from './local';
import { openverse } from './openverse';
import { radio } from './radio';
import { spotify } from './spotify';
import { subsonic } from './subsonic';
import type { MusicSourceAdapter, SourceCategory, SourceContext, SourceStatus } from './types';
import { youtube } from './youtube';

/** Чтобы подключить новый источник, достаточно добавить его адаптер в этот список. */
export const ADAPTERS: MusicSourceAdapter[] = [
  local, subsonic, audius, jamendo, openverse, archive, radio,
  deezer, itunes, yandex, vk, zvuk, youtube, soundcloud, spotify, apple, tidal, bandcamp, youtubeMusic,
];

const byId = new Map(ADAPTERS.map((a) => [a.id, a]));
export const adapter = (id: string) => byId.get(id);
export const sourceName = (id: string) => byId.get(id)?.name ?? id;

export const DIRECT_SOURCES = new Set(ADAPTERS.filter((a) => a.capabilities.playback === 'direct-stream' && a.resolveStream).map((a) => a.id));
export const DEFAULT_PRIORITY = ['local', 'subsonic', 'audius', 'jamendo', 'openverse', 'archive', 'radio'];

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

// Источники, выключенные пользователем. Хранятся в настройках, сюда передаются при загрузке и изменении.
let disabled = new Set<string>();
export function setDisabledSources(ids: string[]) { disabled = new Set(ids); }
export const isDisabled = (id: string) => disabled.has(id);
/** Источники прямого воспроизведения, которые не выключены. */
export const enabledDirect = () => new Set([...DIRECT_SOURCES].filter((id) => !disabled.has(id)));

export async function readySources(ctx: SourceContext, test: (a: MusicSourceAdapter) => boolean): Promise<MusicSourceAdapter[]> {
  const list = ADAPTERS.filter((a) => !disabled.has(a.id) && test(a));
  const states = await Promise.all(list.map((a) => a.status(ctx).catch(() => ({ state: 'needs_setup' }) as SourceStatus)));
  return list.filter((_, i) => states[i].state === 'ready');
}

/** Каталоги для поиска песен, которых нет в свободных источниках. */
export const CATALOG_SOURCES = new Set(['deezer', 'itunes', 'spotify']);
/** Сервисы, где песню можно дослушать полностью по подписке. */
export const LISTEN_ELSEWHERE = ['yandex', 'vk', 'zvuk'];

/** Как трек можно включить в Камертоне. */
export function playMode(t: Pick<RemoteTrack, 'source' | 'availability'> & { extra?: Record<string, unknown> }): 'player' | 'preview' | 'embed' | 'none' {
  const a = byId.get(t.source);
  if (!a || disabled.has(t.source)) return 'none';
  // Запись по ссылке без ключа API играет во встроенном плеере сервиса.
  if (t.extra?.embed && t.availability === 'full') return 'embed';
  if (a.capabilities.playback === 'visible-embed' && t.availability === 'full') return 'embed';
  if (!a.resolveStream) return 'none';
  if (t.availability === 'full' && a.capabilities.playback === 'direct-stream') return 'player';
  if (t.availability === 'preview') return 'preview';
  return 'none';
}

export const isPlayableHere = (t: Pick<RemoteTrack, 'source' | 'availability'>) => DIRECT_SOURCES.has(t.source) && !disabled.has(t.source) && t.availability === 'full';


/** Как источник подключён к Камертону. Telegram-ботов здесь нет: ни у одного изученного нет официального доступа и прав на музыку. */
export type IntegrationKind = 'official-api' | 'official-sdk' | 'authorized-stream' | 'authorized-download' | 'user-import' | 'own-server' | 'catalog' | 'external-player' | 'external-app';

export const INTEGRATION_LABEL: Record<IntegrationKind, string> = {
  'official-api': 'Официальный API',
  'official-sdk': 'Официальный SDK',
  'authorized-stream': 'Разрешённое воспроизведение',
  'authorized-download': 'Разрешённые загрузки',
  'user-import': 'Ваши файлы и импорт',
  'own-server': 'Ваш сервер',
  catalog: 'Каталог для поиска',
  'external-player': 'Встроенный плеер сервиса',
  'external-app': 'Открывается в приложении сервиса',
};

const KIND: Record<string, IntegrationKind> = {
  local: 'user-import', subsonic: 'own-server', audius: 'authorized-stream', jamendo: 'authorized-download', openverse: 'authorized-download',
  archive: 'authorized-download', radio: 'authorized-stream', deezer: 'catalog', itunes: 'catalog', youtube: 'external-player', soundcloud: 'official-api',
  spotify: 'official-api', apple: 'official-sdk',
};

export function integrationOf(a: MusicSourceAdapter): IntegrationKind {
  return KIND[a.id] ?? (a.capabilities.playback === 'external-app' || a.capabilities.playback === 'none' ? 'external-app' : 'official-api');
}

/** Что источник реально умеет в Камертоне: найти, сыграть целиком, в фоне, сохранить для офлайна. */
export function abilities(a: MusicSourceAdapter): { search: boolean; full: boolean; background: boolean; offline: boolean } {
  const p = a.capabilities.playback;
  const full = p === 'direct-stream' || p === 'visible-embed';
  return { search: !!a.search && a.capabilities.supportsSearch !== false, full, background: full && p === 'direct-stream' && a.capabilities.canBackground, offline: full && a.capabilities.canOffline };
}
