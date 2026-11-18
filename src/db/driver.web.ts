// Веб-сборка нужна только для автоматической проверки интерфейса. База живёт в памяти.
import initSqlJs from 'sql.js/dist/sql-asm.js';
import type { Db, SqlValue } from './types';

export async function openDatabase(): Promise<Db> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  const all = async <T,>(sql: string, params: SqlValue[] = []): Promise<T[]> => {
    const st = db.prepare(sql);
    st.bind(params);
    const out: T[] = [];
    while (st.step()) out.push(st.getAsObject() as T);
    st.free();
    return out;
  };
  return {
    exec: async (sql) => { db.exec(sql); },
    run: async (sql, params = []) => { db.run(sql, params); return { changes: db.getRowsModified() }; },
    all,
    get: async <T,>(sql: string, params: SqlValue[] = []) => (await all<T>(sql, params))[0] ?? null,
    tx: async (fn) => {
      db.run('BEGIN');
      try { await fn(); db.run('COMMIT'); } catch (e) { db.run('ROLLBACK'); throw e; }
    },
  };
}
