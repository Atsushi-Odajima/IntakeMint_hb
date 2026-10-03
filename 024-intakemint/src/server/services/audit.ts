import type { Db } from '../db'
import type { Actor } from './context'

/** Append-only audit log. Never store answer bodies or secrets in meta — ids, counts and reasons only. */
export async function audit(db: Db, actor: Actor, action: string, targetType: string | null, targetId: string | null, meta: Record<string, unknown> = {}): Promise<void> {
  await db.query(
    'INSERT INTO audit_logs (org_id, actor_type, actor_id, action, target_type, target_id, meta, ip) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [actor.orgId, actor.type, actor.userId ?? actor.caseId ?? null, action, targetType, targetId, JSON.stringify(meta), actor.ip ?? null],
  )
}
