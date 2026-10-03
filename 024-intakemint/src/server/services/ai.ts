// AI gateway: the ONLY place that calls AI providers. Enforces org/case AI switch, per-file exclusion,
// external-transfer opt-in, logs every call (ai_calls) and stores outputs as candidates only.
import type { Db } from '../db'
import type { Ctx, Actor } from './context'
import { loadState, orgSettings } from './cases'
import { audit } from './audit'
import { sha256 } from '../security/crypto'
import type { AiProvider } from '../ai/providers'

export async function pickProvider(ctx: Ctx, db: Db, orgId: string, caseRow: { ai_enabled: boolean }): Promise<AiProvider | null> {
  const s = await orgSettings(db, orgId)
  if (!s.aiEnabled || !caseRow.ai_enabled) return null
  if (ctx.ai.external && ctx.config.ai.allowExternal) return ctx.ai.external
  return ctx.ai.local
}

async function logCall(db: Db, orgId: string, caseId: string, p: AiProvider, purpose: string, chars: number) {
  await db.query('INSERT INTO ai_calls (org_id, case_id, provider, purpose, input_chars, external) VALUES ($1,$2,$3,$4,$5,$6)', [orgId, caseId, p.name, purpose, chars, p.external])
}

export async function runCaseAnalysis(ctx: Ctx, orgId: string, caseId: string, actor: Actor): Promise<{ skipped?: string; created: number }> {
  const st = await loadState(ctx.db, orgId, caseId)
  const provider = await pickProvider(ctx, ctx.db, orgId, st.row)
  if (!provider) return { skipped: 'ai_disabled', created: 0 }
  const excluded = new Set(st.files.filter((f) => f.ai_excluded).map((f) => f.id))
  const docs = (await ctx.db.query(`SELECT source_id, content FROM ai_documents WHERE case_id=$1 AND org_id=$2 AND source_type='file'`, [caseId, orgId])).rows
    .filter((d) => !excluded.has(d.source_id))
  const fileTexts = docs.map((d) => ({ fileId: d.source_id, name: st.files.find((f) => f.id === d.source_id)?.originalName ?? '', text: d.content }))
  const answers = st.result.logic.effectiveAnswers
  const input = { def: st.def, answers, fileTexts, today: ctx.now().toISOString().slice(0, 10) }
  await logCall(ctx.db, orgId, caseId, provider, 'case_analysis', JSON.stringify(answers).length + fileTexts.reduce((a, f) => a + f.text.length, 0))
  const out = await provider.analyzeCase(input)
  let created = 0
  const ins = async (kind: string, fingerprint: string, payload: unknown, questionId?: string | null) => {
    const r = await ctx.db.query(
      `INSERT INTO ai_candidates (org_id, case_id, kind, question_id, fingerprint, payload, provider) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (case_id, fingerprint) DO NOTHING`,
      [orgId, caseId, kind, questionId ?? null, fingerprint, JSON.stringify(payload), provider.name],
    )
    created += r.rowCount
  }
  for (const f of out.followUps) await ins('follow_up', `fu:${f.questionId}:${sha256(JSON.stringify(answers[f.questionId] ?? '')).slice(0, 16)}`, f, f.questionId)
  for (const a of out.ambiguities) await ins('ambiguous', `amb:${a.questionId}:${sha256(JSON.stringify(answers[a.questionId] ?? '')).slice(0, 16)}`, a, a.questionId)
  for (const c of out.contradictions) await ins('contradiction', c.fingerprint, c, c.sourceRefs[0]?.questionId ?? null)
  // Mark open candidates whose source answer changed as stale (a human still decides).
  const open = (await ctx.db.query(`SELECT id, fingerprint, question_id FROM ai_candidates WHERE case_id=$1 AND status='open' AND kind IN ('follow_up','ambiguous')`, [caseId])).rows
  for (const o of open) {
    const cur = sha256(JSON.stringify(answers[o.question_id] ?? '')).slice(0, 16)
    if (!o.fingerprint.endsWith(cur)) await ctx.db.query(`UPDATE ai_candidates SET payload = payload || '{"stale":true}'::jsonb WHERE id=$1`, [o.id])
  }
  await audit(ctx.db, actor, 'ai.case_analysis', 'case', caseId, { provider: provider.name, external: provider.external, created })
  return { created }
}

export async function classifyAndExtract(ctx: Ctx, orgId: string, fileId: string): Promise<{ skipped?: string }> {
  const f = await ctx.db.one('SELECT f.*, c.ai_enabled FROM files f JOIN cases c ON c.id = f.case_id WHERE f.id=$1 AND f.org_id=$2', [fileId, orgId])
  if (!f) return { skipped: 'not_found' }
  if (f.ai_excluded) return { skipped: 'file_excluded' }
  const provider = await pickProvider(ctx, ctx.db, orgId, f)
  if (!provider) return { skipped: 'ai_disabled' }
  const st = await loadState(ctx.db, orgId, f.case_id)
  const item = st.def.requiredItems.find((i) => i.id === f.item_id)
  let text: string | undefined
  if (f.mime.startsWith('text/')) {
    const buf = await ctx.storage.get(f.storage_key)
    text = buf?.toString('utf8').slice(0, 20000)
  }
  // Classification runs on metadata (+text for text files). Original bytes are never modified.
  await logCall(ctx.db, orgId, f.case_id, provider, 'file_classify', (text?.length ?? 0) + f.original_name.length)
  const cls = await provider.classifyFile({ fileId, name: f.original_name, mime: f.mime, itemCategory: item?.category, itemLabel: item?.label, text })
  const extraction = text
    ? { kind: 'text', preview: text.slice(0, 500), chars: text.length, note: '抽出は候補です。原本が正です。' }
    : { kind: 'none', note: f.mime === 'application/pdf' || f.mime.startsWith('image/') ? 'PDF/画像の文字抽出（OCR/Vision）はプロバイダ未設定のため未実施です。精度は保証されません。' : '抽出対象外の形式です' }
  await ctx.db.query('UPDATE files SET classification=$2, extraction=$3 WHERE id=$1', [fileId, JSON.stringify(cls), JSON.stringify(extraction)])
  if (text) {
    await ctx.db.query(
      `INSERT INTO ai_documents (org_id, case_id, source_type, source_id, content) VALUES ($1,$2,'file',$3,$4)
       ON CONFLICT (case_id, source_type, source_id) DO UPDATE SET content=EXCLUDED.content`, [orgId, f.case_id, fileId, text])
  }
  return {}
}

export async function setFileAiExcluded(ctx: Ctx, actor: Actor, fileId: string, excluded: boolean) {
  const f = await ctx.db.one('SELECT id, case_id FROM files WHERE id=$1 AND org_id=$2', [fileId, actor.orgId])
  if (!f) return null
  if (actor.type === 'client' && actor.caseId !== f.case_id) return null
  await ctx.db.query('UPDATE files SET ai_excluded=$2 WHERE id=$1', [fileId, excluded])
  if (excluded) {
    await ctx.db.query(`DELETE FROM ai_documents WHERE source_type='file' AND source_id=$1`, [fileId])
    await ctx.db.query(`UPDATE files SET extraction=NULL WHERE id=$1`, [fileId])
  }
  await audit(ctx.db, actor, excluded ? 'file.ai_excluded' : 'file.ai_included', 'file', fileId, { caseId: f.case_id })
  return f
}
