import type { Db } from './types';

const MIGRATIONS: string[] = [
  `
  CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);

  CREATE TABLE tracks (
    id TEXT PRIMARY KEY,
    canonical_key TEXT NOT NULL,
    title TEXT NOT NULL,
    artist TEXT NOT NULL,
    album TEXT,
    duration_sec REAL,
    isrc TEXT,
    mbid TEXT,
    year INTEGER,
    release_date TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    mood TEXT,
    bpm REAL,
    cover_url TEXT,
    version_tags TEXT NOT NULL DEFAULT '[]',
    explicit TEXT NOT NULL DEFAULT 'unknown',
    ml_restricted INTEGER NOT NULL DEFAULT 0,
    popularity REAL,
    preferred_source TEXT,
    search_text TEXT NOT NULL DEFAULT '',
    added_at INTEGER NOT NULL
  );
  CREATE INDEX tracks_key ON tracks(canonical_key);
  CREATE INDEX tracks_isrc ON tracks(isrc);
  CREATE INDEX tracks_mbid ON tracks(mbid);

  CREATE TABLE source_tracks (
    id TEXT PRIMARY KEY,
    track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    availability TEXT NOT NULL,
    data TEXT NOT NULL,
    in_pool INTEGER NOT NULL DEFAULT 0,
    in_library INTEGER NOT NULL DEFAULT 0,
    local_path TEXT,
    fetched_at INTEGER NOT NULL
  );
  CREATE INDEX source_tracks_track ON source_tracks(track_id);
  CREATE INDEX source_tracks_pool ON source_tracks(in_pool, availability);
  CREATE INDEX source_tracks_source ON source_tracks(source);

  CREATE TABLE reactions (
    track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    at INTEGER NOT NULL,
    PRIMARY KEY (track_id, kind)
  );

  CREATE TABLE plays (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    source_track_id TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    listened_ms INTEGER NOT NULL DEFAULT 0,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    completed INTEGER NOT NULL DEFAULT 0,
    skipped INTEGER NOT NULL DEFAULT 0,
    context TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX plays_track ON plays(track_id);
  CREATE INDEX plays_time ON plays(started_at);

  CREATE TABLE folders (id TEXT PRIMARY KEY, name TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0);

  CREATE TABLE playlists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
    cover_uri TEXT,
    imported INTEGER NOT NULL DEFAULT 0,
    imported_from TEXT,
    smart_rule TEXT,
    position INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE playlist_items (
    id TEXT PRIMARY KEY,
    playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    original_position INTEGER,
    track_id TEXT REFERENCES tracks(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'matched',
    raw_title TEXT NOT NULL,
    raw_artist TEXT NOT NULL,
    raw_album TEXT,
    raw_duration_sec REAL,
    raw_isrc TEXT,
    match_score REAL,
    match_note TEXT,
    added_at INTEGER NOT NULL
  );
  CREATE INDEX playlist_items_pl ON playlist_items(playlist_id, position);
  CREATE INDEX playlist_items_track ON playlist_items(track_id);

  CREATE TABLE saved_albums (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, artist TEXT NOT NULL, cover_url TEXT,
    source TEXT NOT NULL, source_album_id TEXT NOT NULL, at INTEGER NOT NULL
  );
  CREATE TABLE followed_artists (
    key TEXT PRIMARY KEY, name TEXT NOT NULL, mbid TEXT, at INTEGER NOT NULL
  );

  CREATE TABLE lyrics (
    track_id TEXT PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
    body TEXT, origin TEXT, at INTEGER NOT NULL
  );
  CREATE TABLE music_videos (
    track_id TEXT PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
    provider TEXT NOT NULL, video_id TEXT NOT NULL, title TEXT, origin TEXT NOT NULL, at INTEGER NOT NULL
  );
  CREATE TABLE downloads (
    source_track_id TEXT PRIMARY KEY, path TEXT NOT NULL, bytes INTEGER, at INTEGER NOT NULL
  );

  CREATE TABLE bandit (bucket TEXT PRIMARY KEY, alpha REAL NOT NULL, beta REAL NOT NULL);
  CREATE TABLE recommendations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    source_track_id TEXT NOT NULL,
    bucket TEXT NOT NULL,
    score REAL NOT NULL,
    reason TEXT NOT NULL,
    context TEXT NOT NULL,
    at INTEGER NOT NULL
  );
  CREATE INDEX recommendations_track ON recommendations(track_id, at);
  CREATE TABLE daily_picks (
    day TEXT NOT NULL, position INTEGER NOT NULL,
    track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    source_track_id TEXT NOT NULL, bucket TEXT NOT NULL, reason TEXT NOT NULL,
    PRIMARY KEY (day, position)
  );
  CREATE TABLE friends (id TEXT PRIMARY KEY, name TEXT NOT NULL, card TEXT NOT NULL, at INTEGER NOT NULL);
  `,
];

export async function migrate(db: Db): Promise<void> {
  await db.exec('CREATE TABLE IF NOT EXISTS schema_version (v INTEGER NOT NULL);');
  const row = await db.get<{ v: number }>('SELECT MAX(v) AS v FROM schema_version');
  const current = row?.v ?? 0;
  for (let i = current; i < MIGRATIONS.length; i++) {
    await db.exec(MIGRATIONS[i]);
    await db.run('INSERT INTO schema_version (v) VALUES (?)', [i + 1]);
  }
}
