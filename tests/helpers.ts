import { createRequire } from 'node:module';
import { vi } from 'vitest';
import type { Db, SqlValue } from '@/db/types';
import type { RemoteTrack, TrackView } from '@/core/types';
import type { SourceContext } from '@/sources/types';

const require = createRequire(import.meta.url);

export function memoryDb(): Db {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  let inTx = false;
  return {
    exec: async (sql) => { db.exec(sql); },
    run: async (sql, p: SqlValue[] = []) => ({ changes: Number(db.prepare(sql).run(...p).changes) }),
    all: async <T,>(sql: string, p: SqlValue[] = []) => db.prepare(sql).all(...p).map((r: any) => ({ ...r })) as T[],
    get: async <T,>(sql: string, p: SqlValue[] = []) => { const r = db.prepare(sql).get(...p); return (r ? { ...r } : null) as T | null; },
    tx: async (fn) => {
      // Как и настоящая SQLite: вторая транзакция поверх первой является ошибкой.
      if (inTx) throw new Error('cannot start a transaction within a transaction');
      inTx = true; db.exec('BEGIN');
      try { await fn(); db.exec('COMMIT'); }
      catch (e) { db.exec('ROLLBACK'); throw e; }
      finally { inTx = false; }
    },
  };
}

export function memoryCtx(values: Record<string, Record<string, string>> = {}): SourceContext {
  const store = { ...values };
  return {
    getConfig: async (id) => store[id] ?? {},
    setConfig: async (id, v) => { store[id] = { ...store[id], ...v }; },
    clearConfig: async (id) => { delete store[id]; },
  };
}

export function mockFetch(routes: [RegExp, unknown | ((url: string) => unknown)][]) {
  const calls: string[] = [];
  const fn = vi.fn(async (url: string) => {
    calls.push(url);
    for (const [re, body] of routes) {
      if (re.test(url)) {
        const value = typeof body === 'function' ? (body as (u: string) => unknown)(url) : body;
        return { ok: true, status: 200, headers: { get: () => null }, json: async () => value } as unknown as Response;
      }
    }
    return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) } as unknown as Response;
  });
  vi.stubGlobal('fetch', fn);
  return calls;
}

export function remote(over: Partial<RemoteTrack> & { title: string; artist: string }): RemoteTrack {
  return { source: 'audius', sourceTrackId: `${over.artist}-${over.title}`, explicit: 'unknown', availability: 'full', durationSec: 200, ...over };
}

export function view(id: string, over: Partial<TrackView> & { artist?: string; title?: string } = {}): TrackView {
  const artist = over.artist ?? `Artist ${id}`;
  const title = over.title ?? `Track ${id}`;
  const preferred = { ...remote({ title, artist, sourceTrackId: id }), id: `audius:${id}`, trackId: id, fetchedAt: 0 };
  return {
    id, canonicalKey: `${artist.toLowerCase()}|${title.toLowerCase()}|`, title, artist, tags: [], versionTags: [], explicit: 'unknown', mlRestricted: false,
    addedAt: 0, sources: [preferred], preferred, liked: false, durationSec: 200, ...over,
  };
}
