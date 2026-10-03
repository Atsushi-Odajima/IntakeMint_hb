// Internal notifications with storm prevention: identical (org, case, type) events within the window are coalesced.
import type { Db } from '../db'

export const COALESCE_MINUTES = 10

export async function notify(db: Db, orgId: string, caseId: string | null, type: string, title: string, now = new Date()): Promise<void> {
  const since = new Date(now.getTime() - COALESCE_MINUTES * 60_000)
  const existing = await db.one<{ id: string }>(
    `SELECT id FROM notifications WHERE org_id=$1 AND case_id IS NOT DISTINCT FROM $2 AND type=$3 AND read_at IS NULL AND updated_at >= $4 ORDER BY updated_at DESC LIMIT 1`,
    [orgId, caseId, type, since],
  )
  if (existing) {
    await db.query('UPDATE notifications SET count = count + 1, title=$2, updated_at=$3 WHERE id=$1', [existing.id, title, now])
  } else {
    await db.query('INSERT INTO notifications (org_id, case_id, type, title, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$5)', [orgId, caseId, type, title, now])
  }
}
