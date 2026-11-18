import * as SQLite from 'expo-sqlite';
import type { Db, SqlValue } from './types';

/** Драйвер SQLite для телефона. */
export async function openDatabase(): Promise<Db> {
  const db = await SQLite.openDatabaseAsync('kamerton.db');
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  return {
    exec: (sql) => db.execAsync(sql),
    run: async (sql, params: SqlValue[] = []) => {
      const r = await db.runAsync(sql, params);
      return { changes: r.changes };
    },
    all: <T>(sql: string, params: SqlValue[] = []) => db.getAllAsync<T>(sql, params),
    get: async <T>(sql: string, params: SqlValue[] = []) => (await db.getFirstAsync<T>(sql, params)) ?? null,
    tx: (fn) => db.withTransactionAsync(fn),
  };
}
