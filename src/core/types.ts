// Общие сущности приложения. Ни один тип здесь не привязан к конкретному сервису.

export type SourceId = string;

/** Можно ли послушать трек и как именно. */
export type Availability =
  | 'full' // полное воспроизведение
  | 'preview' // только короткий фрагмент
  | 'subscription_required' // нужна подписка или доступ
  | 'external_only' // только на официальном сервисе
  | 'region_blocked' // недоступно в регионе
  | 'gone'; // больше недоступно

/**
 * Что известно о версии с точки зрения цензуры.
 * unknown означает, что источник этого не сообщает: мы не притворяемся, что знаем.
 */
export type ExplicitState = 'explicit' | 'not_explicit' | 'clean' | 'unknown';

export type VersionTag =
  | 'clean'
  | 'radio_edit'
  | 'explicit_marked'
  | 'remix'
  | 'live'
  | 'cover'
  | 'karaoke'
  | 'instrumental'
  | 'acoustic'
  | 'sped_up'
  | 'slowed'
  | 'nightcore'
  | 'remaster'
  | 'demo';

export interface AudioQuality {
  codec?: string;
  bitrateKbps?: number;
  sampleRateHz?: number;
  bitDepth?: number;
  lossless?: boolean;
}

/** Трек в том виде, в каком его отдал конкретный источник. */
export interface RemoteTrack {
  source: SourceId;
  sourceTrackId: string;
  title: string;
  artist: string;
  artists?: string[];
  artistId?: string;
  album?: string;
  albumId?: string;
  trackNumber?: number;
  durationSec?: number;
  isrc?: string;
  mbid?: string;
  explicit: ExplicitState;
  tags?: string[];
  mood?: string;
  bpm?: number;
  year?: number;
  releaseDate?: string;
  coverUrl?: string;
  availability: Availability;
  quality?: AudioQuality;
  licenseUrl?: string;
  attribution?: string;
  externalUrl?: string;
  isLive?: boolean;
  popularity?: number;
  canOffline?: boolean;
  /** Служебные данные адаптера, например варианты файлов. */
  extra?: Record<string, unknown>;
}

/** Трек в библиотеке: одна песня, у которой может быть несколько источников. */
export interface Track {
  id: string;
  canonicalKey: string;
  title: string;
  artist: string;
  album?: string;
  durationSec?: number;
  isrc?: string;
  mbid?: string;
  year?: number;
  releaseDate?: string;
  tags: string[];
  mood?: string;
  bpm?: number;
  coverUrl?: string;
  versionTags: VersionTag[];
  explicit: ExplicitState;
  /** Данные пришли только из источника, запрещающего использование в ML. */
  mlRestricted: boolean;
  popularity?: number;
  addedAt: number;
}

export interface SourceTrack extends RemoteTrack {
  id: string; // source:sourceTrackId
  trackId: string;
  fetchedAt: number;
  localPath?: string;
}

export interface TrackView extends Track {
  sources: SourceTrack[];
  preferred: SourceTrack | null;
  liked: boolean;
}

export type ReactionKind = 'like' | 'dislike' | 'more' | 'less' | 'hide';

export interface PlayRecord {
  id?: number;
  trackId: string;
  sourceTrackId: string;
  startedAt: number;
  listenedMs: number;
  durationMs: number;
  completed: boolean;
  skipped: boolean;
  context: string;
}

export interface Reaction {
  trackId: string;
  kind: ReactionKind;
  at: number;
}

export type PlaylistItemStatus = 'matched' | 'doubtful' | 'missing' | 'clean_only';

export interface PlaylistItem {
  id: string;
  playlistId: string;
  position: number;
  /** Позиция в исходном плейлисте при импорте. */
  originalPosition?: number;
  trackId?: string;
  status: PlaylistItemStatus;
  rawTitle: string;
  rawArtist: string;
  rawAlbum?: string;
  rawDurationSec?: number;
  rawIsrc?: string;
  matchScore?: number;
  matchNote?: string;
  addedAt: number;
}

export interface Playlist {
  id: string;
  name: string;
  description?: string;
  folderId?: string;
  coverUri?: string;
  imported: boolean;
  importedFrom?: string;
  smartRule?: string;
  createdAt: number;
  updatedAt: number;
  itemCount?: number;
}

export interface Folder {
  id: string;
  name: string;
  position: number;
}

export type DiscoveryBucket = 'familiar' | 'new_for_you' | 'fresh' | 'rare' | 'new_artist';

export interface Recommendation {
  trackId: string;
  sourceTrackId: string;
  bucket: DiscoveryBucket;
  score: number;
  reason: string;
}

export interface LyricLine {
  timeMs?: number;
  text: string;
}

export interface Lyrics {
  lines: LyricLine[];
  synced: boolean;
  origin: string;
}

export interface MusicVideo {
  provider: 'youtube';
  videoId: string;
  title?: string;
  origin: string;
}
