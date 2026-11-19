// Единый контракт источника музыки. Плеер и экраны читают только эти поля
// и ничего не знают о конкретных сервисах.

import type { Lyrics, RemoteTrack, SourceId } from '@/core/types';

export type PlaybackMode = 'direct-stream' | 'external-app' | 'visible-embed' | 'preview-only' | 'none';
export type AuthMode = 'none' | 'apiKey' | 'oauthPkce' | 'oauthConfidential' | 'server';
export type SourceCategory = 'own' | 'server' | 'independent' | 'open' | 'radio' | 'commercial';
export type QualityPreference = 'data_saver' | 'normal' | 'high' | 'lossless';

export interface SourceCapabilities {
  playback: PlaybackMode;
  canCrossfade: boolean;
  canGapless: boolean;
  canBackground: boolean;
  canOffline: boolean;
  canMixWithOtherSources: boolean;
  requiresVisiblePlayer: boolean;
  auth: AuthMode;
  requiresBackend: boolean;
  requiresUserSubscription: boolean;
  requiresOfficialApp: boolean;
  supportsSearch: boolean;
  supportsDiscovery: boolean;
  supportsLibraryImport: boolean;
  supportsPlaylistImport: boolean;
  supportsDeepLink: boolean;
  metadata: { isrc: boolean; explicit: boolean; genres: boolean; audioFeatures: boolean; license: boolean };
  mlAllowed: boolean;
  attributionRequired: boolean;
  /** Сохранять на телефон можно не все песни источника, а только разрешённые (решается для каждой песни). */
  offlineScope?: 'all' | 'some';
}

/** Честное состояние подключения. */
export type ConnectionState =
  | 'ready' // работает прямо сейчас
  | 'needs_setup' // пользователь должен ввести ключ или адрес сервера
  | 'link_only' // только открыть официальный сервис
  | 'not_implemented'; // архитектура готова, интеграция не включена

export interface SourceStatus {
  state: ConnectionState;
  detail?: string;
  account?: string;
}

export interface ConfigField {
  key: string;
  label: string;
  hint?: string;
  secret?: boolean;
  required?: boolean;
  placeholder?: string;
}

export interface SourceDoc {
  summary: string;
  limits: string[];
  unconfirmed: string[];
  setup: string[];
  docsUrl?: string;
}

export interface AlbumRef { source: SourceId; id: string; title: string; artist: string; coverUrl?: string; year?: number; releaseDate?: string; trackCount?: number; kind?: string }
export interface ArtistRef { source: SourceId; id: string; name: string; imageUrl?: string; followers?: number }
export interface PlaylistRef { source: SourceId; id: string; title: string; owner?: string; coverUrl?: string; trackCount?: number }

export interface SearchOutcome {
  hasMore?: boolean;
  tracks: RemoteTrack[];
  albums: AlbumRef[];
  artists: ArtistRef[];
  playlists: PlaylistRef[];
}

export const emptySearch = (): SearchOutcome => ({ tracks: [], albums: [], artists: [], playlists: [] });

export interface DiscoverRequest {
  tags: string[];
  artists: string[];
  limit: number;
  mode: 'taste' | 'popular' | 'fresh' | 'rare';
}

export interface StreamSource { uri: string; headers?: Record<string, string>; quality?: RemoteTrack['quality'] }

export interface SourceContext {
  getConfig(sourceId: SourceId): Promise<Record<string, string>>;
  setConfig(sourceId: SourceId, values: Record<string, string>): Promise<void>;
  clearConfig(sourceId: SourceId): Promise<void>;
}

export interface MusicSourceAdapter {
  id: SourceId;
  name: string;
  category: SourceCategory;
  capabilities: SourceCapabilities;
  doc: SourceDoc;
  configFields?: ConfigField[];

  status(ctx: SourceContext): Promise<SourceStatus>;
  /** Проверка введённых данных настоящим запросом к сервису. */
  verify?(ctx: SourceContext): Promise<string>;
  /** page начинается с 0. Источник сообщает hasMore, если есть следующая страница. */
  search?(ctx: SourceContext, q: string, limit: number, page?: number): Promise<SearchOutcome>;
  discover?(ctx: SourceContext, req: DiscoverRequest): Promise<RemoteTrack[]>;
  albumTracks?(ctx: SourceContext, albumId: string): Promise<RemoteTrack[]>;
  artistTracks?(ctx: SourceContext, artistId: string): Promise<RemoteTrack[]>;
  artistAlbums?(ctx: SourceContext, artistId: string): Promise<AlbumRef[]>;
  /** Лёгкий поиск только по трекам: для сопоставления больших плейлистов. */
  searchTracks?(ctx: SourceContext, q: string, limit: number): Promise<RemoteTrack[]>;
  userPlaylists?(ctx: SourceContext): Promise<PlaylistRef[]>;
  playlistTracks?(ctx: SourceContext, id: string): Promise<RemoteTrack[]>;
  likedTracks?(ctx: SourceContext): Promise<RemoteTrack[]>;
  /** Разбирает ссылку на плейлист или трек этого источника. */
  resolveLink?(ctx: SourceContext, url: string): Promise<{ title: string; tracks: RemoteTrack[] } | null>;
  canHandleLink?(url: string): boolean;
  resolveStream?(ctx: SourceContext, t: RemoteTrack, q: QualityPreference): Promise<StreamSource>;
  lyrics?(ctx: SourceContext, t: RemoteTrack): Promise<Lyrics | null>;
  onPlayStarted?(ctx: SourceContext, t: RemoteTrack): Promise<void>;
  onPlayFinished?(ctx: SourceContext, t: RemoteTrack): Promise<void>;
  /** Ссылка на композицию в официальном сервисе. */
  externalUrl?(q: { title: string; artist: string; externalUrl?: string }): string | null;
}

const BASE: SourceCapabilities = {
  playback: 'none', canCrossfade: false, canGapless: false, canBackground: false, canOffline: false,
  canMixWithOtherSources: false, requiresVisiblePlayer: false, auth: 'none', requiresBackend: false,
  requiresUserSubscription: false, requiresOfficialApp: false, supportsSearch: false, supportsDiscovery: false,
  supportsLibraryImport: false, supportsPlaylistImport: false, supportsDeepLink: false,
  metadata: { isrc: false, explicit: false, genres: false, audioFeatures: false, license: false },
  mlAllowed: true, attributionRequired: false,
};

export function caps(over: Omit<Partial<SourceCapabilities>, 'metadata'> & { metadata?: Partial<SourceCapabilities['metadata']> }): SourceCapabilities {
  return { ...BASE, ...over, metadata: { ...BASE.metadata, ...over.metadata } };
}

export const DIRECT = { playback: 'direct-stream', canBackground: true, canGapless: true, canCrossfade: true, canMixWithOtherSources: true } as const;
