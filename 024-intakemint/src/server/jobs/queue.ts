// DB-backed background job queue (Postgres row locking with SKIP LOCKED in production; works on PGlite single-process).
import type { Db } from '../db'

export interface JobRow { id: string; type: string; payload: any; attempts: number; max_attempts: number }

export async function enqueue(db: Db, type: string, payload: Record<string, unknown>, opts: { runAt?: Date; dedupeKey?: string; maxAttempts?: number } = {}): Promise<void> {
  await db.query(
    `INSERT INTO jobs (type, payload, run_at, dedupe_key, max_attempts) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (dedupe_key) DO UPDATE SET run_at = LEAST(jobs.run_at, EXCLUDED.run_at), status = CASE WHEN jobs.status IN ('done','failed') THEN 'queued' ELSE jobs.status END, attempts = CASE WHEN jobs.status IN ('done','failed') THEN 0 ELSE jobs.attempts END`,
    [type, JSON.stringify(payload), opts.runAt ?? new Date(), opts.dedupeKey ?? null, opts.maxAttempts ?? 5],
  )
}

export async function claim(db: Db, now: Date, limit = 10): Promise<JobRow[]> {
  const r = await db.query<JobRow>(
    `UPDATE jobs SET status='running', locked_at=$1, attempts = attempts + 1
     WHERE id IN (SELECT id FROM jobs WHERE status='queued' AND run_at <= $1 ORDER BY run_at LIMIT $2 FOR UPDATE SKIP LOCKED)
     RETURNING id, type, payload, attempts, max_attempts`,
    [now, limit],
  )
  return r.rows
}

export async function complete(db: Db, id: string): Promise<void> {
  // dedupe_key is released so the same logical job can be enqueued again later
  await db.query(`UPDATE jobs SET status='done', locked_at=NULL, dedupe_key=NULL WHERE id=$1`, [id])
}

export async function fail(db: Db, job: JobRow, err: string, now: Date): Promise<void> {
  if (job.attempts >= job.max_attempts) {
    await db.query(`UPDATE jobs SET status='failed', last_error=$2, locked_at=NULL, dedupe_key=NULL WHERE id=$1`, [job.id, err.slice(0, 500)])
  } else {
    const backoff = Math.min(3600, 2 ** job.attempts * 15)
    await db.query(`UPDATE jobs SET status='queued', last_error=$2, locked_at=NULL, run_at=$3 WHERE id=$1`, [job.id, err.slice(0, 500), new Date(now.getTime() + backoff * 1000)])
  }
}
