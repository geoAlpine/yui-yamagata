import { Pool } from 'pg';

/**
 * 接続プール。
 * 本番はVPS上のPostgreSQLに同居させるため、コネクション数は控えめに固定する
 * （既存の商用サイトとメモリを取り合わないこと。DESIGN.md 7章）。
 */
const globalForPg = globalThis as unknown as { pool?: Pool };

export const pool =
  globalForPg.pool ??
  new Pool({
    connectionString:
      process.env.DATABASE_URL ?? 'postgresql://localhost:5432/bousai',
    max: 8,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

if (process.env.NODE_ENV !== 'production') globalForPg.pool = pool;

export async function query<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  const res = await pool.query(text, params);
  return res.rows as T[];
}
