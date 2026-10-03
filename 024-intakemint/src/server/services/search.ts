// Permission-filtered search over cases, clients, projects, questions, responses, file metadata and tags.
// Results are ALWAYS filtered by the caller's org_id inside SQL (never post-filtered in app code).
import type { Db } from '../db'
import type { Ctx, Actor } from './context'
import { requirePerm } from './rbac'

export async function indexEntity(db: Db, e: { type: string; id: string; orgId: string; workspaceId?: string | null; caseId?: string | null; title: string; body?: string; tags?: string[] }): Promise<void> {
  await db.query(
    `INSERT INTO search_index (entity_type, entity_id, org_id, workspace_id, case_id, title, body, tags, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())
     ON CONFLICT (entity_type, entity_id) DO UPDATE SET title=EXCLUDED.title, body=EXCLUDED.body, tags=EXCLUDED.tags, updated_at=now()`,
    [e.type, e.id, e.orgId, e.workspaceId ?? null, e.caseId ?? null, e.title.slice(0, 500), (e.body ?? '').slice(0, 20000), e.tags ?? []],
  )
}

export async function removeEntity(db: Db, type: string, id: string): Promise<void> {
  await db.query('DELETE FROM search_index WHERE entity_type=$1 AND entity_id=$2', [type, id])
}

const escLike = (s: string) => s.replace(/[\\%_]/g, (m) => '\\' + m)

export async function search(ctx: Ctx, actor: Actor, q: string, opts: { type?: string; limit?: number } = {}) {
  requirePerm(actor, 'read')
  const term = q.trim().slice(0, 100)
  if (!term) return []
  const like = `%${escLike(term)}%`
  const rows = (await ctx.db.query(
    `SELECT s.entity_type, s.entity_id, s.case_id, s.title, left(s.body, 200) AS snippet, s.tags, s.updated_at,
            c.project_name, c.client_name, c.status
     FROM search_index s LEFT JOIN cases c ON c.id = s.case_id AND c.org_id = s.org_id
     WHERE s.org_id = $1 AND ((s.title || ' ' || s.body) ILIKE $2 ESCAPE '\\' OR $3 = ANY(s.tags))
       AND ($4::text IS NULL OR s.entity_type = $4)
     ORDER BY (s.title ILIKE $2 ESCAPE '\\') DESC, s.updated_at DESC LIMIT $5`,
    [actor.orgId, like, term, opts.type ?? null, Math.min(opts.limit ?? 30, 100)],
  )).rows
  return rows
}
