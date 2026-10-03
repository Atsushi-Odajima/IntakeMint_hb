// Database abstraction: PostgreSQL (node-postgres) in production, PGlite (embedded Postgres/WASM) for dev/test/demo.
// All SQL uses $1..$n placeholders — never string concatenation of user input.
import { MIGRATIONS } from './schema'

export interface QueryResult<T> { rows: T[]; rowCount: number }
export interface Db {
  query<T = any>(sql: string, params?: unknown[]): Promise<QueryResult<T>>
  one<T = any>(sql: string, params?: unknown[]): Promise<T | null>
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>
  /** multi-statement SQL without parameters (migrations only) */
  exec(sql: string): Promise<void>
  close(): Promise<void>
  readonly kind: 'pglite' | 'postgres'
}

type RawQuery = (sql: string, params?: unknown[]) => Promise<{ rows: any[]; affectedRows?: number; rowCount?: number | null }>

function wrap(kind: Db['kind'], q: RawQuery, txImpl: Db['tx'], close: () => Promise<void>, exec?: (sql: string) => Promise<unknown>): Db {
  const db: Db = {
    kind,
    async query(sql, params = []) {
      const r = await q(sql, params)
      return { rows: r.rows, rowCount: (r.rowCount ?? r.affectedRows ?? r.rows.length) as number }
    },
    async one(sql, params = []) { return ((await db.query(sql, params)).rows[0] ?? null) },
    tx: txImpl,
    async exec(sql) { if (exec) await exec(sql); else await q(sql) },
    close,
  }
  return db
}

export async function createPgliteDb(dataDir?: string): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite')
  const { pg_trgm } = await import('@electric-sql/pglite/contrib/pg_trgm')
  const pg = await PGlite.create({ dataDir, extensions: { pg_trgm } })
  const self: Db = wrap('pglite', (s, p) => pg.query(s, p as any[]) as any, async (fn) => {
    return pg.transaction(async (t) => {
      const txDb: Db = wrap('pglite', (s, p) => t.query(s, p as any[]) as any, (f) => f(txDb), async () => {}, (s) => t.exec(s))
      return await fn(txDb)
    }) as any
  }, async () => { await pg.close() }, (s) => pg.exec(s))
  return self
}

export async function createPostgresDb(url: string): Promise<Db> {
  const pgmod = await import('pg')
  const Pool = (pgmod as any).default?.Pool ?? (pgmod as any).Pool
  const pool = new Pool({ connectionString: url, max: Number(process.env.PG_POOL_MAX ?? 10) })
  const self: Db = wrap('postgres', (s, p) => (p && p.length ? pool.query(s, p) : pool.query(s)), async (fn) => {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const txDb: Db = wrap('postgres', (s, p) => (p && p.length ? client.query(s, p) : client.query(s)), (f) => f(txDb), async () => {})
      const r = await fn(txDb)
      await client.query('COMMIT')
      return r
    } catch (e) {
      await client.query('ROLLBACK'); throw e
    } finally { client.release() }
  }, async () => { await pool.end() })
  return self
}

export async function migrate(db: Db): Promise<void> {
  await db.query('CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())')
  const done = new Set((await db.query<{ version: number }>('SELECT version FROM schema_migrations')).rows.map((r) => r.version))
  for (const m of MIGRATIONS) {
    if (done.has(m.version)) continue
    await db.tx(async (t) => {
      // PGlite & pg both accept multi-statement strings without parameters via simple query protocol.
      await t.exec(m.sql)
      await t.query('INSERT INTO schema_migrations (version) VALUES ($1)', [m.version])
    })
  }
}

export async function openDb(): Promise<Db> {
  const url = process.env.DATABASE_URL
  const db = url ? await createPostgresDb(url) : await createPgliteDb(process.env.PGLITE_DIR || undefined)
  await migrate(db)
  return db
}
