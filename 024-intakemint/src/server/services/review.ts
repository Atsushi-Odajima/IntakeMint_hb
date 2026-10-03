// Internal review & Ready gate. Ready requires the deterministic engine + human sign-off; override needs reason/actor/time.
import type { Ctx, Actor } from './context'
import { badRequest, conflict, notFound } from './context'
import { requirePerm } from './rbac'
import { audit } from './audit'
import { loadState, recompute } from './cases'
import { readyExceptSignoff } from '../../shared/completeness'
import type { Db } from '../db'

async function addReview(db: Db, actor: Actor, caseId: string, targetType: string, targetId: string, decision: string, note?: string | null) {
  await db.query('INSERT INTO reviews (org_id, case_id, target_type, target_id, decision, note, actor_type, actor_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [actor.orgId, caseId, targetType, targetId, decision, note ?? null, actor.type, actor.userId ?? null])
}

export async function reviewFile(ctx: Ctx, actor: Actor, fileId: string, decision: 'accept' | 'reject', note?: string) {
  requirePerm(actor, 'review')
  const f = await ctx.db.one('SELECT id, case_id, status FROM files WHERE id=$1 AND org_id=$2', [fileId, actor.orgId])
  if (!f) throw notFound('ファイル')
  if (decision === 'reject' && !note?.trim()) throw badRequest('差し戻し理由を入力してください（クライアントに表示されます）')
  await ctx.db.tx(async (db) => {
    await db.query('UPDATE files SET status=$2, review_note=$3 WHERE id=$1', [fileId, decision === 'accept' ? 'accepted' : 'rejected', note ?? null])
    await addReview(db, actor, f.case_id, 'file', fileId, decision, note)
    await audit(db, actor, `file.${decision}`, 'file', fileId, { caseId: f.case_id, previous: f.status })
  })
  // Rejecting (especially a previously accepted file) is a required-information change => Ready re-evaluation.
  return (await recompute(ctx, ctx.db, actor.orgId, f.case_id, actor, { requiredChanged: decision === 'reject' })).result
}

export async function reviewItem(ctx: Ctx, actor: Actor, caseId: string, itemId: string, decision: 'accept' | 'reject' | 'needs_review' | 'not_applicable' | 'reopen', note?: string) {
  requirePerm(actor, 'review')
  const st = await loadState(ctx.db, actor.orgId, caseId)
  const ev = st.result.items.find((i) => i.itemId === itemId)
  if (!ev) throw notFound('必要項目')
  if (decision === 'reject' && !note?.trim()) throw badRequest('差し戻し理由を入力してください（クライアントに表示されます）')
  if (decision === 'not_applicable' && !note?.trim()) throw badRequest('対象外にする理由を入力してください')
  if (decision === 'accept' && ev.type === 'question' && (ev.status === 'missing' || ev.status === 'partial')) throw conflict('未回答の項目は承認できません')
  if (decision === 'accept' && ev.type === 'file' && (ev.count ?? 0) < (ev.minCount ?? 1)) throw conflict(`必要数に達していません（${ev.count}/${ev.minCount}）`)
  const status = decision === 'accept' ? 'accepted' : decision === 'reject' ? 'rejected' : decision === 'reopen' ? 'none' : decision
  await ctx.db.tx(async (db) => {
    await db.query(
      `INSERT INTO item_states (org_id, case_id, item_id, review_status, note, reviewed_by, reviewed_at) VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (case_id, item_id) DO UPDATE SET review_status=EXCLUDED.review_status, note=EXCLUDED.note, reviewed_by=EXCLUDED.reviewed_by, reviewed_at=EXCLUDED.reviewed_at`,
      [actor.orgId, caseId, itemId, status, note ?? null, actor.userId ?? null, ctx.now()],
    )
    if (decision === 'accept' && ev.type === 'file') {
      await db.query(`UPDATE files SET status='accepted' WHERE case_id=$1 AND item_id=$2 AND status='pending_review'`, [caseId, itemId])
    }
    await addReview(db, actor, caseId, 'item', itemId, decision, note)
    await audit(db, actor, `item.${decision}`, 'case', caseId, { itemId })
  })
  return (await recompute(ctx, ctx.db, actor.orgId, caseId, actor, { requiredChanged: decision !== 'accept' })).result
}

/** Resolve an AI candidate. Nothing becomes a requirement or reaches the client without this human step. */
export async function resolveCandidate(ctx: Ctx, actor: Actor, candidateId: string, decision: 'send_to_client' | 'dismiss' | 'resolve', opts: { text?: string; note?: string } = {}) {
  requirePerm(actor, 'review')
  const c = await ctx.db.one('SELECT * FROM ai_candidates WHERE id=$1 AND org_id=$2', [candidateId, actor.orgId])
  if (!c) throw notFound('AI候補')
  if (c.status !== 'open') throw conflict('この候補は処理済みです')
  await ctx.db.tx(async (db) => {
    if (decision === 'send_to_client') {
      const text = (opts.text ?? c.payload.text ?? '').trim()
      if (!text) throw badRequest('質問文を入力してください')
      await db.query('INSERT INTO followups (org_id, case_id, candidate_id, question_id, text, options, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [actor.orgId, c.case_id, c.id, c.question_id, text.slice(0, 2000), c.payload.options ? JSON.stringify(c.payload.options) : null, actor.userId ?? null])
    }
    const status = decision === 'send_to_client' ? 'sent_to_client' : decision === 'dismiss' ? 'dismissed' : 'resolved'
    await db.query('UPDATE ai_candidates SET status=$2, resolved_by=$3, resolved_at=$4 WHERE id=$1', [c.id, status, actor.userId ?? null, ctx.now()])
    await addReview(db, actor, c.case_id, 'ai_candidate', c.id, decision === 'send_to_client' ? 'needs_client' : decision === 'dismiss' ? 'dismiss' : 'accept', opts.note)
    await audit(db, actor, `ai_candidate.${decision}`, 'case', c.case_id, { candidateId: c.id, kind: c.kind })
  })
  return (await recompute(ctx, ctx.db, actor.orgId, c.case_id, actor)).result
}

/** Human asks the client for more information (also used by MCP request_more_information after confirmation). */
export async function requestMoreInfo(ctx: Ctx, actor: Actor, caseId: string, text: string, questionId?: string) {
  requirePerm(actor, 'review')
  const c = await ctx.db.one('SELECT id FROM cases WHERE id=$1 AND org_id=$2', [caseId, actor.orgId])
  if (!c) throw notFound('案件')
  if (!text?.trim()) throw badRequest('質問文を入力してください')
  const r = await ctx.db.one<{ id: string }>('INSERT INTO followups (org_id, case_id, question_id, text, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [actor.orgId, caseId, questionId ?? null, text.trim().slice(0, 2000), actor.userId ?? null])
  await addReview(ctx.db, actor, caseId, 'case', caseId, 'needs_client', text.slice(0, 200))
  await audit(ctx.db, actor, 'followup.create', 'case', caseId, { followupId: r!.id })
  await recompute(ctx, ctx.db, actor.orgId, caseId, actor)
  return r!.id
}

export async function resolveFollowup(ctx: Ctx, actor: Actor, followupId: string, decision: 'resolve' | 'reopen' | 'cancel', opts: { applyToQuestion?: boolean; note?: string } = {}) {
  requirePerm(actor, 'review')
  const f = await ctx.db.one('SELECT * FROM followups WHERE id=$1 AND org_id=$2', [followupId, actor.orgId])
  if (!f) throw notFound('追加質問')
  let requiredChanged = false
  await ctx.db.tx(async (db) => {
    if (decision === 'resolve' && opts.applyToQuestion && f.question_id && f.answer !== null) {
      const st = await loadState(db, actor.orgId, f.case_id)
      const q = st.def.questions.find((x) => x.id === f.question_id)
      if (q && (q.type === 'long_text' || q.type === 'short_text')) {
        const prev = typeof st.answers[q.id] === 'string' ? (st.answers[q.id] as string) : ''
        const add = typeof f.answer === 'string' ? f.answer : JSON.stringify(f.answer)
        const merged = prev ? `${prev}\n（追加回答）${add}` : add
        await db.query(`INSERT INTO responses (org_id, case_id, question_id, value, updated_by_kind) VALUES ($1,$2,$3,$4,'internal')
          ON CONFLICT (case_id, question_id) DO UPDATE SET value=EXCLUDED.value, version=responses.version+1, updated_by_kind='internal', updated_at=now()`,
          [actor.orgId, f.case_id, q.id, JSON.stringify(merged)])
        requiredChanged = true
      }
    }
    const status = decision === 'resolve' ? 'resolved' : decision === 'reopen' ? 'open' : 'cancelled'
    await db.query('UPDATE followups SET status=$2 WHERE id=$1', [followupId, status])
    if (f.candidate_id && decision === 'resolve') await db.query(`UPDATE ai_candidates SET status='resolved', resolved_at=now() WHERE id=$1`, [f.candidate_id])
    await addReview(db, actor, f.case_id, 'case', f.case_id, decision === 'resolve' ? 'accept' : decision === 'reopen' ? 'needs_client' : 'dismiss', opts.note ?? `followup:${followupId}`)
    await audit(db, actor, `followup.${decision}`, 'case', f.case_id, { followupId, applied: !!opts.applyToQuestion })
  })
  return (await recompute(ctx, ctx.db, actor.orgId, f.case_id, actor, { requiredChanged })).result
}

export async function signoff(ctx: Ctx, actor: Actor, caseId: string, note?: string) {
  requirePerm(actor, 'ready.signoff')
  const st = await loadState(ctx.db, actor.orgId, caseId)
  if (!readyExceptSignoff(st.result)) throw conflict('Ready条件を満たしていないためサインオフできません', st.result.ready.reasons)
  await ctx.db.query('UPDATE cases SET internal_signoff_at=$2, internal_signoff_by=$3 WHERE id=$1', [caseId, ctx.now(), actor.userId ?? null])
  await addReview(ctx.db, actor, caseId, 'case', caseId, 'signoff', note)
  await audit(ctx.db, actor, 'case.signoff', 'case', caseId, {})
  return recompute(ctx, ctx.db, actor.orgId, caseId, actor)
}

export async function overrideReady(ctx: Ctx, actor: Actor, caseId: string, reason: string) {
  requirePerm(actor, 'ready.override')
  if (!reason || reason.trim().length < 5) throw badRequest('Ready上書きには理由（5文字以上）が必要です')
  const st = await loadState(ctx.db, actor.orgId, caseId)
  if (st.result.ready.ready) throw conflict('すでにReady条件を満たしています')
  const u = actor.userId ? await ctx.db.one('SELECT name FROM users WHERE id=$1', [actor.userId]) : null
  const ov = { reason: reason.trim().slice(0, 1000), actorId: actor.userId, actorName: u?.name ?? actor.type, at: ctx.now().toISOString(), unmet: st.result.ready.reasons }
  await ctx.db.query('UPDATE cases SET ready_override=$2 WHERE id=$1', [caseId, JSON.stringify(ov)])
  await addReview(ctx.db, actor, caseId, 'case', caseId, 'accept', `READY OVERRIDE: ${ov.reason}`)
  await audit(ctx.db, actor, 'case.ready_override', 'case', caseId, { reason: ov.reason, unmet: ov.unmet.map((r) => r.code) })
  return recompute(ctx, ctx.db, actor.orgId, caseId, actor)
}
