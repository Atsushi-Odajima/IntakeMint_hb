// Responses, file submissions and client-side actions.
import crypto from 'node:crypto'
import type { Ctx, Actor } from './context'
import { badRequest, conflict, notFound, forbidden } from './context'
import { requirePerm } from './rbac'
import { audit } from './audit'
import { notify } from './notifications'
import { affectsRequired, loadState, recompute } from './cases'
import { indexEntity, removeEntity } from './search'
import { enqueue } from '../jobs/queue'
import { classifyAndExtract } from './ai'
import { validateAnswer } from '../../shared/validate'
import { isAnswered } from '../../shared/logic'
import { effectiveItems } from '../../shared/completeness'
import { checkUpload, sanitizeFilename } from '../security/upload'
import { sha256 } from '../security/crypto'

function assertCaseAccess(actor: Actor, caseId: string) {
  if (actor.type === 'client') { if (actor.caseId !== caseId) throw forbidden() }
  else requirePerm(actor, 'case.edit')
}

function answerText(v: unknown): string {
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'object' ? Object.values(x ?? {}).join(' ') : String(x))).join(' ')
  return v === null || v === undefined ? '' : String(v)
}

export async function saveAnswers(ctx: Ctx, actor: Actor, caseId: string, input: Record<string, unknown>) {
  assertCaseAccess(actor, caseId)
  const st = await loadState(ctx.db, actor.orgId, caseId)
  if (['started', 'archived', 'cancelled'].includes(st.row.status) && actor.type === 'client') throw conflict('この案件は受付を終了しました')
  const qById = new Map(st.def.questions.map((q) => [q.id, q]))
  const errors: { questionId: string; message: string }[] = []
  const changed: string[] = []
  const entries = Object.entries(input)
  if (entries.length > 300) throw badRequest('一度に保存できる回答数を超えています')
  await ctx.db.tx(async (db) => {
    for (const [qid, value] of entries) {
      const q = qById.get(qid)
      if (!q) { errors.push({ questionId: qid, message: '存在しない質問です' }); continue }
      if (q.type === 'file' || q.type === 'image') continue
      if (JSON.stringify(value ?? null).length > 50_000) { errors.push({ questionId: qid, message: '回答が長すぎます' }); continue }
      const msg = validateAnswer(q, value)
      if (msg) { errors.push({ questionId: qid, message: msg }); continue }
      const prev = st.answers[qid]
      if (JSON.stringify(prev ?? null) === JSON.stringify(isAnswered(value) ? value : null)) continue
      if (!isAnswered(value)) {
        await db.query('DELETE FROM responses WHERE case_id=$1 AND question_id=$2 AND org_id=$3', [caseId, qid, actor.orgId])
        await removeEntity(db, 'response', `${caseId}:${qid}`)
      } else {
        await db.query(
          `INSERT INTO responses (org_id, case_id, question_id, value, updated_by_kind, updated_at) VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (case_id, question_id) DO UPDATE SET value=EXCLUDED.value, version=responses.version+1, updated_by_kind=EXCLUDED.updated_by_kind, updated_at=EXCLUDED.updated_at`,
          [actor.orgId, caseId, qid, JSON.stringify(value), actor.type === 'client' ? 'client' : 'internal', ctx.now()],
        )
        await indexEntity(db, { type: 'response', id: `${caseId}:${qid}`, orgId: actor.orgId, workspaceId: st.row.workspace_id, caseId, title: q.label, body: answerText(value).slice(0, 5000), tags: q.tags })
      }
      changed.push(qid)
    }
    if (!changed.length) return
    // A changed answer re-opens review of the items it belongs to (rejected => resubmitted, accepted => re-check).
    const items = effectiveItems(st.def).filter((it) => (it.questionIds ?? []).some((q) => changed.includes(q)))
    for (const it of items) {
      await db.query(`UPDATE item_states SET review_status='none', reviewed_at=NULL WHERE case_id=$1 AND item_id=$2 AND review_status IN ('rejected','accepted','needs_review')`, [caseId, it.id])
    }
    await audit(db, actor, 'response.save', 'case', caseId, { questionIds: changed })
  })
  if (changed.length) {
    if (actor.type === 'client') await notify(ctx.db, actor.orgId, caseId, 'client_response', `回答が更新されました: ${st.row.project_name}`, ctx.now())
    await enqueue(ctx.db, 'ai_case_analysis', { orgId: actor.orgId, caseId }, { dedupeKey: `ai:${caseId}`, runAt: new Date(ctx.now().getTime() + 2000) })
  }
  const after = await recompute(ctx, ctx.db, actor.orgId, caseId, actor, { requiredChanged: changed.length > 0 && affectsRequired(st.def, changed) })
  return { saved: changed, errors, completeness: after.result, status: after.row.status }
}

export async function uploadFile(ctx: Ctx, actor: Actor, caseId: string, itemId: string, filename: string, buf: Buffer, opts: { aiExcluded?: boolean } = {}) {
  assertCaseAccess(actor, caseId)
  const st = await loadState(ctx.db, actor.orgId, caseId)
  if (['started', 'archived', 'cancelled'].includes(st.row.status) && actor.type === 'client') throw conflict('この案件は受付を終了しました')
  const item = st.def.requiredItems.find((i) => i.id === itemId && i.type === 'file')
  if (!item) throw badRequest('提出先の項目が見つかりません')
  const ev = st.result.items.find((i) => i.itemId === itemId)
  if (ev && !ev.applicable) throw badRequest('この項目は現在提出対象外です')
  const active = st.files.filter((f) => f.itemId === itemId && f.status !== 'rejected').length
  if (item.maxCount && active >= item.maxCount) throw badRequest(`この項目は最大${item.maxCount}件までです`)
  const name = sanitizeFilename(filename)
  const maxBytes = Math.min(item.maxSizeMB ?? ctx.config.maxUploadMB, ctx.config.maxUploadMB) * 1024 * 1024
  const chk = checkUpload(name, buf, item.acceptedFormats, maxBytes)
  if (!chk.ok) {
    await audit(ctx.db, actor, 'file.upload_rejected', 'case', caseId, { itemId, reason: chk.error })
    throw badRequest(chk.error!)
  }
  const scan = await ctx.scanner.scan(buf)
  if (scan === 'error') {
    await audit(ctx.db, actor, 'file.scan_error', 'case', caseId, { itemId, scanner: ctx.scanner.name })
    throw badRequest('セキュリティチェックを完了できませんでした。時間をおいて再度お試しください')
  }
  if (scan === 'infected') {
    await audit(ctx.db, actor, 'file.malware_detected', 'case', caseId, { itemId, scanner: ctx.scanner.name })
    throw badRequest('セキュリティチェックでブロックされました。別のファイルを提出してください')
  }
  const fileId = crypto.randomUUID()
  const key = `${actor.orgId}/${caseId}/${fileId}.${chk.ext}`
  await ctx.storage.put(key, buf, chk.mime!)
  const settingsReview = item.requireReview ?? st.def.completionRules.requireFileReview
  await ctx.db.tx(async (db) => {
    await db.query(
      `INSERT INTO files (id, org_id, case_id, item_id, original_name, storage_key, mime, ext, size, sha256, status, scan_status, ai_excluded, uploaded_by_kind, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [fileId, actor.orgId, caseId, itemId, name, key, chk.mime, chk.ext, buf.length, sha256(buf), settingsReview ? 'pending_review' : 'accepted', scan,
        !!opts.aiExcluded, actor.type === 'client' ? 'client' : 'internal', ctx.now()],
    )
    await db.query(`UPDATE item_states SET review_status='none' WHERE case_id=$1 AND item_id=$2 AND review_status IN ('rejected','needs_review')`, [caseId, itemId])
    await indexEntity(db, { type: 'file', id: fileId, orgId: actor.orgId, workspaceId: st.row.workspace_id, caseId, title: name, body: `${item.label} ${item.category ?? ''}`, tags: [item.category ?? 'other'] })
    await audit(db, actor, 'file.upload', 'file', fileId, { caseId, itemId, size: buf.length, mime: chk.mime, scan })
  })
  if (actor.type === 'client') await notify(ctx.db, actor.orgId, caseId, 'file_upload', `ファイルが提出されました: ${st.row.project_name}`, ctx.now())
  await classifyAndExtract(ctx, actor.orgId, fileId)
  await enqueue(ctx.db, 'ai_case_analysis', { orgId: actor.orgId, caseId }, { dedupeKey: `ai:${caseId}`, runAt: new Date(ctx.now().getTime() + 2000) })
  const after = await recompute(ctx, ctx.db, actor.orgId, caseId, actor, { requiredChanged: true })
  return { fileId, status: settingsReview ? 'pending_review' : 'accepted', completeness: after.result }
}

/** Client deletes an own, not-yet-reviewed upload (e.g. wrong photo). Accepted/rejected files stay for the record. */
export async function deleteOwnUpload(ctx: Ctx, actor: Actor, fileId: string) {
  const f = await ctx.db.one('SELECT id, case_id, storage_key, status, uploaded_by_kind FROM files WHERE id=$1 AND org_id=$2', [fileId, actor.orgId])
  if (!f || (actor.type === 'client' && f.case_id !== actor.caseId)) throw notFound('ファイル')
  if (actor.type === 'client' && (f.status !== 'pending_review' || f.uploaded_by_kind !== 'client')) throw conflict('確認済みのファイルは削除できません')
  if (actor.type !== 'client') requirePerm(actor, 'case.edit')
  await ctx.db.query('DELETE FROM files WHERE id=$1', [fileId])
  await removeEntity(ctx.db, 'file', fileId)
  await ctx.storage.delete(f.storage_key)
  await audit(ctx.db, actor, 'file.delete', 'file', fileId, { caseId: f.case_id })
  await recompute(ctx, ctx.db, actor.orgId, f.case_id, actor, { requiredChanged: true })
}

export async function clientSubmit(ctx: Ctx, actor: Actor, caseId: string) {
  assertCaseAccess(actor, caseId)
  const st = await loadState(ctx.db, actor.orgId, caseId)
  await ctx.db.query('UPDATE cases SET client_submitted_at=$2 WHERE id=$1', [caseId, ctx.now()])
  const complete = st.result.progress.submitted === st.result.progress.denominator
  await notify(ctx.db, actor.orgId, caseId, complete ? 'complete_candidate' : 'client_submitted_partial',
    complete ? `提出完了候補: ${st.row.project_name}` : `クライアントが送信（未提出あり）: ${st.row.project_name}`, ctx.now())
  await audit(ctx.db, actor, 'client.submit', 'case', caseId, { complete })
  const after = await recompute(ctx, ctx.db, actor.orgId, caseId, actor)
  return { complete, completeness: after.result, status: after.row.status }
}

export async function answerFollowup(ctx: Ctx, actor: Actor, caseId: string, followupId: string, answer: unknown) {
  assertCaseAccess(actor, caseId)
  if (!isAnswered(answer) || JSON.stringify(answer).length > 10000) throw badRequest('回答を入力してください')
  const r = await ctx.db.query(`UPDATE followups SET answer=$3, status='answered', answered_at=$4 WHERE id=$1 AND case_id=$2 AND status='open'`, [followupId, caseId, JSON.stringify(answer), ctx.now()])
  if (!r.rowCount) throw notFound('追加質問')
  await audit(ctx.db, actor, 'followup.answer', 'case', caseId, { followupId })
  await notify(ctx.db, actor.orgId, caseId, 'client_response', `追加質問に回答がありました`, ctx.now())
  return (await recompute(ctx, ctx.db, actor.orgId, caseId, actor)).result
}
