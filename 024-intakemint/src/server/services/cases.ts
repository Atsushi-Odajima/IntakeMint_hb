// Cases: lifecycle, deterministic recompute (progress / status / Ready re-evaluation), dashboard.
import type { Db } from '../db'
import type { Ctx, Actor } from './context'
import { badRequest, conflict, notFound } from './context'
import { requirePerm } from './rbac'
import { audit } from './audit'
import { notify } from './notifications'
import { getVersion } from './templates'
import { indexEntity } from './search'
import { evaluateCompleteness, effectiveItems, missingSummary, type CompletenessResult } from '../../shared/completeness'
import { conditionQuestionIds } from '../../shared/logic'
import type { Answers, CaseStatus, FileInfo, ItemReviewState, TemplateDefinition } from '../../shared/types'

export interface OrgSettings {
  aiEnabled: boolean
  timezone: string
  retentionDays: number
  branding: { color: string; senderName: string; logoDataUrl?: string; intro?: string; completionMessage?: string }
  allowUrlTitleFetch: boolean
}

export const DEFAULT_ORG_SETTINGS: OrgSettings = {
  aiEnabled: true, timezone: 'Asia/Tokyo', retentionDays: 365, allowUrlTitleFetch: false,
  branding: { color: '#0F2D2A', senderName: 'IntakeMint' },
}

export async function orgSettings(db: Db, orgId: string): Promise<OrgSettings> {
  const o = await db.one<{ settings: Partial<OrgSettings> }>('SELECT settings FROM organizations WHERE id=$1', [orgId])
  const s = o?.settings ?? {}
  return { ...DEFAULT_ORG_SETTINGS, ...s, branding: { ...DEFAULT_ORG_SETTINGS.branding, ...(s.branding ?? {}) } }
}

export interface CaseState {
  row: any
  def: TemplateDefinition
  answers: Answers
  files: (FileInfo & { ai_excluded: boolean; scan_status: string; classification: any; created_at: string; review_note: string | null; ext: string })[]
  itemStates: ItemReviewState[]
  unresolvedAi: number
  result: CompletenessResult
}

export async function loadState(db: Db, orgId: string, caseId: string): Promise<CaseState> {
  const row = await db.one('SELECT * FROM cases WHERE id=$1 AND org_id=$2', [caseId, orgId])
  if (!row) throw notFound('案件')
  const v = await getVersion(db, orgId, row.template_version_id)
  const answers: Answers = {}
  for (const r of (await db.query('SELECT question_id, value FROM responses WHERE case_id=$1 AND org_id=$2', [caseId, orgId])).rows) answers[r.question_id] = r.value
  const files = (await db.query(
    `SELECT id, item_id AS "itemId", status, original_name AS "originalName", mime, size::int AS size, ai_excluded, scan_status, classification, created_at, review_note, ext
     FROM files WHERE case_id=$1 AND org_id=$2 ORDER BY created_at`, [caseId, orgId])).rows
  const itemStates = (await db.query(`SELECT item_id AS "itemId", review_status AS "reviewStatus", note FROM item_states WHERE case_id=$1 AND org_id=$2`, [caseId, orgId])).rows
  const ai = await db.one<{ n: number }>(
    `SELECT (SELECT count(*) FROM ai_candidates WHERE case_id=$1 AND org_id=$2 AND status='open' AND kind IN ('follow_up','ambiguous','missing','contradiction'))
          + (SELECT count(*) FROM followups WHERE case_id=$1 AND org_id=$2 AND status IN ('open','answered')) AS n`, [caseId, orgId])
  const unresolvedAi = Number(ai?.n ?? 0)
  const result = evaluateCompleteness({ def: v.definition, answers, files, itemStates, unresolvedAiCount: unresolvedAi, internalSignoff: !!row.internal_signoff_at })
  return { row, def: v.definition, answers, files, itemStates, unresolvedAi, result }
}

/** Does a change to these questions affect required information (items or rule sources)? */
export function affectsRequired(def: TemplateDefinition, questionIds: string[]): boolean {
  const set = new Set<string>()
  for (const it of effectiveItems(def)) for (const q of it.questionIds ?? []) set.add(q)
  for (const r of def.rules) for (const q of conditionQuestionIds(r.when)) set.add(q)
  return questionIds.some((q) => set.has(q))
}

const TERMINAL: CaseStatus[] = ['started', 'archived', 'cancelled']

/**
 * Re-evaluate a case after any change. When required information changed after Ready,
 * sign-off and override are invalidated and Ready is revoked (re-review required).
 */
export async function recompute(ctx: Ctx, db: Db, orgId: string, caseId: string, actor: Actor, opts: { requiredChanged?: boolean } = {}): Promise<CaseState> {
  let st = await loadState(db, orgId, caseId)
  const row = st.row
  if (opts.requiredChanged && (row.internal_signoff_at || row.ready_override)) {
    await db.query('UPDATE cases SET internal_signoff_at=NULL, internal_signoff_by=NULL, ready_override=NULL WHERE id=$1', [caseId])
    st = await loadState(db, orgId, caseId)
  }
  const r = st.result
  let status: CaseStatus = st.row.status
  const wasReady = status === 'ready'
  if (!TERMINAL.includes(status)) {
    const hasLink = !!(await db.one('SELECT 1 FROM case_access_tokens WHERE case_id=$1 LIMIT 1', [caseId]))
    const anyInput = Object.keys(st.answers).length > 0 || st.files.length > 0
    const openFollowups = Number((await db.one<{ n: number }>(`SELECT count(*) AS n FROM followups WHERE case_id=$1 AND status='open'`, [caseId]))!.n)
    const rejected = r.items.some((i) => i.applicable && i.required && i.status === 'rejected')
    const allSubmitted = r.progress.submitted === r.progress.denominator
    if (r.ready.ready || st.row.ready_override) status = 'ready'
    else if (rejected || openFollowups > 0) status = 'needs_client'
    else if (allSubmitted && anyInput) status = 'needs_internal_review'
    else if (st.row.client_submitted_at && !allSubmitted) status = 'needs_client'
    else if (anyInput) status = 'in_progress'
    else if (hasLink) status = 'sent'
    else status = 'draft'
  }
  const readyAt = status === 'ready' ? (st.row.ready_at ?? ctx.now()) : TERMINAL.includes(status) ? st.row.ready_at : null
  const summary = missingSummary(r.items)
  await db.query(
    `UPDATE cases SET status=$2, progress=$3, missing_summary=$4, ready_at=$5, last_activity_at=$6 WHERE id=$1`,
    [caseId, status, JSON.stringify(r.progress), summary, readyAt, ctx.now()],
  )
  if (wasReady && status !== 'ready') {
    await audit(db, actor, 'case.ready_revoked', 'case', caseId, { reasons: r.ready.reasons.map((x) => x.code) })
    await notify(db, orgId, caseId, 'ready_revoked', `Ready解除: ${st.row.project_name}（必須情報が変更されました）`, ctx.now())
  } else if (!wasReady && status === 'ready') {
    await audit(db, actor, 'case.ready', 'case', caseId, { override: !!st.row.ready_override })
    await notify(db, orgId, caseId, 'ready', `Ready: ${st.row.project_name}`, ctx.now())
  }
  if (st.row.status !== status && status === 'needs_internal_review') {
    await notify(db, orgId, caseId, 'review_needed', `内部確認待ち: ${st.row.project_name}`, ctx.now())
  }
  st.row = { ...st.row, status, ready_at: readyAt, missing_summary: summary, progress: r.progress }
  await indexEntity(db, { type: 'case', id: caseId, orgId, workspaceId: st.row.workspace_id, caseId, title: `${st.row.project_name} ${st.row.client_name}`, body: `${summary} ${st.row.client_email ?? ''}`, tags: st.row.tags })
  return st
}

export async function createCase(ctx: Ctx, actor: Actor, input: { templateId: string; clientName: string; clientEmail?: string; projectName: string; targetReadyDate?: string; ownerId?: string; tags?: string[] }) {
  requirePerm(actor, 'case.create')
  const t = await ctx.db.one('SELECT id, workspace_id, current_version_id, status FROM templates WHERE id=$1 AND org_id=$2', [input.templateId, actor.orgId])
  if (!t) throw notFound('テンプレート')
  if (!t.current_version_id || t.status === 'archived') throw badRequest('公開済みテンプレートから案件を作成してください')
  const settings = await orgSettings(ctx.db, actor.orgId)
  const c = await ctx.db.one<{ id: string }>(
    `INSERT INTO cases (org_id, workspace_id, template_version_id, client_name, client_email, project_name, owner_id, target_ready_date, timezone, tags, ai_enabled)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [actor.orgId, t.workspace_id, t.current_version_id, input.clientName, input.clientEmail ?? null, input.projectName, input.ownerId ?? actor.userId ?? null,
      input.targetReadyDate ?? null, settings.timezone, input.tags ?? [], settings.aiEnabled],
  )
  await audit(ctx.db, actor, 'case.create', 'case', c!.id, { templateVersionId: t.current_version_id })
  await recompute(ctx, ctx.db, actor.orgId, c!.id, actor)
  return c!.id
}

export async function caseDetail(ctx: Ctx, actor: Actor, caseId: string) {
  requirePerm(actor, 'read')
  const st = await loadState(ctx.db, actor.orgId, caseId)
  const [candidates, followups, reviews, reminders, links, packages, auditRows, version] = await Promise.all([
    ctx.db.query('SELECT * FROM ai_candidates WHERE case_id=$1 AND org_id=$2 ORDER BY created_at DESC', [caseId, actor.orgId]),
    ctx.db.query('SELECT * FROM followups WHERE case_id=$1 AND org_id=$2 ORDER BY created_at DESC', [caseId, actor.orgId]),
    ctx.db.query(`SELECT r.*, u.name AS actor_name FROM reviews r LEFT JOIN users u ON u.id = r.actor_id WHERE r.case_id=$1 AND r.org_id=$2 ORDER BY r.created_at DESC LIMIT 200`, [caseId, actor.orgId]),
    ctx.db.query('SELECT * FROM reminders WHERE case_id=$1 AND org_id=$2 ORDER BY created_at DESC', [caseId, actor.orgId]),
    ctx.db.query('SELECT id, expires_at, revoked_at, created_at, last_used_at, require_email_verification, email_verified_at FROM case_access_tokens WHERE case_id=$1 AND org_id=$2 ORDER BY created_at DESC', [caseId, actor.orgId]),
    ctx.db.query('SELECT id, version, profile, created_at FROM packages WHERE case_id=$1 AND org_id=$2 ORDER BY version DESC', [caseId, actor.orgId]),
    ctx.db.query(`SELECT id, actor_type, action, target_type, target_id, meta, created_at FROM audit_logs WHERE org_id=$1 AND (target_id=$2 OR meta->>'caseId'=$2) ORDER BY created_at DESC LIMIT 100`, [actor.orgId, caseId]),
    getVersion(ctx.db, actor.orgId, st.row.template_version_id),
  ])
  return {
    case: st.row, template: { id: version.template_id, version: version.version, name: version.name }, definition: st.def,
    answers: st.answers, files: st.files, itemStates: st.itemStates, completeness: st.result,
    candidates: candidates.rows, followups: followups.rows, reviews: reviews.rows, reminders: reminders.rows,
    links: links.rows, packages: packages.rows, audit: auditRows.rows,
  }
}

export async function listCases(ctx: Ctx, actor: Actor, f: { status?: string; q?: string; limit?: number; offset?: number } = {}) {
  requirePerm(actor, 'read')
  return (await ctx.db.query(
    `SELECT id, client_name, project_name, status, progress, missing_summary, target_ready_date, last_activity_at, ready_at, created_at, tags
     FROM cases WHERE org_id=$1 AND ($2::text IS NULL OR status=$2) AND ($3::text IS NULL OR project_name ILIKE $3 OR client_name ILIKE $3)
     ORDER BY last_activity_at DESC LIMIT $4 OFFSET $5`,
    [actor.orgId, f.status ?? null, f.q ? `%${f.q.replace(/[\\%_]/g, (m) => '\\' + m)}%` : null, Math.min(f.limit ?? 50, 200), f.offset ?? 0],
  )).rows
}

/** Internal dashboard buckets. Uses (org_id, status, last_activity_at) and target_ready_date partial indexes. */
export async function dashboard(ctx: Ctx, actor: Actor) {
  requirePerm(actor, 'read')
  const today = ctx.now().toISOString().slice(0, 10)
  const cols = 'id, client_name, project_name, status, progress, missing_summary, target_ready_date, last_activity_at'
  const q = (where: string, params: unknown[] = []) => ctx.db.query(`SELECT ${cols} FROM cases WHERE org_id=$1 AND ${where} ORDER BY last_activity_at DESC LIMIT 20`, [actor.orgId, ...params]).then((r) => r.rows)
  const [newCases, waitingClient, needsReview, overdue, ready, recent, counts] = await Promise.all([
    q(`status IN ('draft','sent')`),
    q(`status IN ('in_progress','needs_client')`),
    q(`status = 'needs_internal_review'`),
    q(`target_ready_date < $2 AND status NOT IN ('ready','started','archived','cancelled')`, [today]),
    q(`status = 'ready'`),
    q(`status NOT IN ('archived','cancelled')`),
    ctx.db.query(`SELECT status, count(*)::int AS n FROM cases WHERE org_id=$1 GROUP BY status`, [actor.orgId]).then((r) => r.rows),
  ])
  return { newCases, waitingClient, needsReview, overdue, ready, recent, counts }
}

export async function updateCase(ctx: Ctx, actor: Actor, caseId: string, input: { clientName?: string; clientEmail?: string | null; projectName?: string; targetReadyDate?: string | null; tags?: string[]; aiEnabled?: boolean; status?: 'archived' | 'cancelled' }) {
  requirePerm(actor, 'case.edit')
  const c = await ctx.db.one('SELECT id, status FROM cases WHERE id=$1 AND org_id=$2', [caseId, actor.orgId])
  if (!c) throw notFound('案件')
  await ctx.db.query(
    `UPDATE cases SET client_name=COALESCE($3,client_name), client_email=CASE WHEN $4::boolean THEN $5 ELSE client_email END, project_name=COALESCE($6,project_name),
      target_ready_date=CASE WHEN $7::boolean THEN $8::date ELSE target_ready_date END, tags=COALESCE($9,tags), ai_enabled=COALESCE($10,ai_enabled),
      status=COALESCE($11,status), archived_at=CASE WHEN $11 = 'archived' THEN now() ELSE archived_at END WHERE id=$1 AND org_id=$2`,
    [caseId, actor.orgId, input.clientName ?? null, input.clientEmail !== undefined, input.clientEmail ?? null, input.projectName ?? null,
      input.targetReadyDate !== undefined, input.targetReadyDate ?? null, input.tags ?? null, input.aiEnabled ?? null, input.status ?? null],
  )
  if (input.aiEnabled === false) {
    // AI OFF for the case: drop AI index derived text immediately.
    await ctx.db.query('DELETE FROM ai_documents WHERE case_id=$1 AND org_id=$2', [caseId, actor.orgId])
  }
  await audit(ctx.db, actor, 'case.update', 'case', caseId, { fields: Object.keys(input) })
  if (!input.status) await recompute(ctx, ctx.db, actor.orgId, caseId, actor)
}

export async function markStarted(ctx: Ctx, actor: Actor, caseId: string) {
  requirePerm(actor, 'case.edit')
  const c = await ctx.db.one('SELECT status FROM cases WHERE id=$1 AND org_id=$2', [caseId, actor.orgId])
  if (!c) throw notFound('案件')
  if (c.status !== 'ready') throw conflict('Readyの案件のみ開始済みにできます')
  await ctx.db.query(`UPDATE cases SET status='started', started_at=$2, last_activity_at=$2 WHERE id=$1`, [caseId, ctx.now()])
  await audit(ctx.db, actor, 'case.started', 'case', caseId, {})
}

/** Hard delete: responses, files (objects), AI index, search index, candidates, packages. Audit keeps a tombstone without content. */
export async function deleteCase(ctx: Ctx, actor: Actor, caseId: string) {
  requirePerm(actor, 'case.delete')
  const c = await ctx.db.one('SELECT id FROM cases WHERE id=$1 AND org_id=$2', [caseId, actor.orgId])
  if (!c) throw notFound('案件')
  const keys = (await ctx.db.query('SELECT storage_key FROM files WHERE case_id=$1', [caseId])).rows.map((r) => r.storage_key as string)
  await ctx.db.tx(async (db) => {
    await db.query('DELETE FROM ai_documents WHERE case_id=$1', [caseId])
    await db.query('DELETE FROM search_index WHERE case_id=$1', [caseId])
    await db.query('DELETE FROM cases WHERE id=$1 AND org_id=$2', [caseId, actor.orgId]) // cascades
    await audit(db, actor, 'case.delete', 'case', caseId, { files: keys.length })
  })
  for (const k of keys) await ctx.storage.delete(k).catch(() => {})
}
