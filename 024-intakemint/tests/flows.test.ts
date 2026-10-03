// Service-level flows: required tests #8 #12 #14-#20 #23 #24 #27 #29 and E2E-1/2/3/5/6/7/8 (API/service level).
import { describe, it, expect } from 'vitest'
import { makeCtx, makeOrg, webTemplate, Clock } from './helpers'
import { createCase, loadState, deleteCase, recompute } from '../src/server/services/cases'
import { issueLink } from '../src/server/services/access'
import { saveAnswers, uploadFile, answerFollowup, clientSubmit } from '../src/server/services/intake'
import { reviewFile, reviewItem, resolveCandidate, resolveFollowup, signoff, overrideReady } from '../src/server/services/review'
import { runCaseAnalysis, setFileAiExcluded } from '../src/server/services/ai'
import { planReminder, approveReminder, scanReminders } from '../src/server/services/reminders'
import { generatePackage } from '../src/server/services/packages'
import { updateDraft, publishTemplate, getTemplate } from '../src/server/services/templates'
import { updateSettings } from '../src/server/services/orgs'
import { exportOrg, restoreOrg, relationFingerprint } from '../src/server/services/backup'
import { runJobsOnce } from '../src/server/jobs/worker'
import { notify } from '../src/server/services/notifications'
import { callTool, TOOLS } from '../src/mcp/tools'
import { createMcpServer } from '../src/mcp/server'
import { createApiToken } from '../src/server/services/orgs'
import { makePng, makePdf } from '../src/server/seed'
import { LocalHeuristicProvider, type AiProvider, type CaseAnalysisInput, type FileClassifyInput } from '../src/server/ai/providers'
import type { Actor } from '../src/server/services/context'
import { zipSync, strToU8 } from 'fflate'

class SpyExternal implements AiProvider {
  readonly name = 'spy-external'; readonly external = true
  calls: { kind: string; input: any }[] = []
  private inner = new LocalHeuristicProvider()
  async analyzeCase(i: CaseAnalysisInput) { this.calls.push({ kind: 'case', input: i }); return this.inner.analyzeCase(i) }
  async classifyFile(i: FileClassifyInput) { this.calls.push({ kind: 'file', input: i }); return this.inner.classifyFile(i) }
}

const baseAnswers = {
  company_name: '株式会社サンプル', company_address: '東京都', ceo_message: '代表挨拶の本文です。お客様に信頼される会社を目指します。',
  site_purpose: ['company', 'inquiry'], site_goal: '問い合わせを月20件に増やしたい', business_description: 'オリジナル雑貨の企画・製造・オンライン販売を行っています。',
  reference_sites: [{ url: 'https://example.com/', reason: '余白' }], contact_name: '花子', contact_email: 'h@example.test', privacy_ack: true,
}

async function setup(o: Parameters<typeof makeCtx>[0] = {}) {
  const env = await makeCtx(o)
  const A = await makeOrg(env.ctx, 'Studio')
  const t = await webTemplate(env.ctx, A.owner, A.workspaceId)
  const caseId = await createCase(env.ctx, A.owner, { templateId: t.templateId, clientName: '株式会社サンプル', clientEmail: 'client@example.test', projectName: 'コーポレートサイト制作', targetReadyDate: '2026-10-08' })
  await issueLink(env.ctx, A.owner, caseId)
  const client: Actor = { type: 'client', orgId: A.orgId, caseId }
  return { ...env, A, t, caseId, client }
}

async function completeAll(s: Awaited<ReturnType<typeof setup>>) {
  await saveAnswers(s.ctx, s.client, s.caseId, baseAnswers)
  await uploadFile(s.ctx, s.client, s.caseId, 'logo', 'logo.pdf', makePdf('logo'))
  for (let i = 0; i < 5; i++) await uploadFile(s.ctx, s.client, s.caseId, 'product_images', `p${i}.png`, makePng(i * 10, 100, 100))
  await runCaseAnalysis(s.ctx, s.A.orgId, s.caseId, s.A.owner)
  await reviewItem(s.ctx, s.A.owner, s.caseId, 'logo', 'accept')
  await reviewItem(s.ctx, s.A.owner, s.caseId, 'product_images', 'accept')
}

describe('E2E-1 Web template: share → answers → branching → Logo missing / Images 3/5 → reminder → resubmit → review → Ready → Developer Handoff', () => {
  it('runs the whole flow', async () => {
    const s = await setup()
    await saveAnswers(s.ctx, s.client, s.caseId, { ...baseAnswers, site_purpose: ['company', 'ec'], ec_product_count: 12, ec_payment: ['card'] })
    for (let i = 0; i < 3; i++) await uploadFile(s.ctx, s.client, s.caseId, 'product_images', `p${i}.png`, makePng(i, 2, 3))
    let st = await loadState(s.ctx.db, s.A.orgId, s.caseId)
    expect(st.result.items.find((i) => i.itemId === 'logo')!.status).toBe('missing')
    expect(st.result.items.find((i) => i.itemId === 'product_images')!).toMatchObject({ status: 'partial', count: 3, minCount: 5 })
    expect(st.result.items.find((i) => i.itemId === 'q:ec_product_count')!.applicable).toBe(true)
    expect(st.row.status).toBe('in_progress')
    // reminder 3 days before target (2026-10-08 vs clock 2026-10-05) — missing items only
    const rid = await planReminder(s.ctx, s.ctx.db, s.A.orgId, s.caseId)
    const rem = await s.ctx.db.one('SELECT * FROM reminders WHERE id=$1', [rid])
    expect(rem.status).toBe('draft')
    expect(rem.body).toContain('ロゴデータ：未提出'); expect(rem.body).toContain('（3/5）'); expect(rem.body).not.toContain('会社情報')
    await approveReminder(s.ctx, s.A.owner, rid!)
    await runJobsOnce(s.ctx); await runJobsOnce(s.ctx)
    expect(s.email.sent.length).toBe(1)
    // resubmission
    await uploadFile(s.ctx, s.client, s.caseId, 'logo', 'logo.pdf', makePdf())
    for (let i = 3; i < 5; i++) await uploadFile(s.ctx, s.client, s.caseId, 'product_images', `p${i}.png`, makePng(i, 2, 3))
    await clientSubmit(s.ctx, s.client, s.caseId)
    st = await loadState(s.ctx.db, s.A.orgId, s.caseId)
    expect(st.row.status).toBe('needs_internal_review')
    await runCaseAnalysis(s.ctx, s.A.orgId, s.caseId, s.A.owner)
    await reviewItem(s.ctx, s.A.owner, s.caseId, 'logo', 'accept')
    await reviewItem(s.ctx, s.A.owner, s.caseId, 'product_images', 'accept')
    const after = await signoff(s.ctx, s.A.owner, s.caseId, 'OK')
    expect(after.row.status).toBe('ready')
    const pkg = await generatePackage(s.ctx, s.A.owner, s.caseId, 'web_development')
    expect(pkg.markdown).toContain('Web Development Handoff')
    expect(pkg.markdown).toContain('Acceptance Criteria（候補）')
    expect(pkg.markdown).toContain('files/logo/')
    expect(pkg.package.handoff.blocks.find((b) => b.title.startsWith('Pages'))!.entries.map((e) => e.value).join()).toContain('商品一覧')
  })
})

describe('#8 / E2E-2 AI candidates are never auto-confirmed', () => {
  it('vague answer → follow-up candidate → human sends → client answers → completeness updated', async () => {
    const s = await setup()
    await completeAll(s)
    await saveAnswers(s.ctx, s.client, s.caseId, { site_goal: '会社のサイトです' })
    await runCaseAnalysis(s.ctx, s.A.orgId, s.caseId, s.A.owner)
    let st = await loadState(s.ctx.db, s.A.orgId, s.caseId)
    const cand = (await s.ctx.db.query(`SELECT * FROM ai_candidates WHERE case_id=$1 AND kind='follow_up' AND status='open'`, [s.caseId])).rows[0]
    expect(cand).toBeTruthy()
    // AI did not change answers, did not create followups, Ready blocked by AI_UNRESOLVED
    expect(st.answers.site_goal).toBe('会社のサイトです')
    expect((await s.ctx.db.query('SELECT * FROM followups WHERE case_id=$1', [s.caseId])).rowCount).toBe(0)
    expect(st.result.ready.reasons.map((r) => r.code)).toContain('AI_UNRESOLVED')
    await expect(signoff(s.ctx, s.A.owner, s.caseId)).rejects.toThrow()
    // human sends to client
    await resolveCandidate(s.ctx, s.A.owner, cand.id, 'send_to_client')
    st = await loadState(s.ctx.db, s.A.orgId, s.caseId)
    expect(st.row.status).toBe('needs_client')
    const fu = (await s.ctx.db.query('SELECT * FROM followups WHERE case_id=$1', [s.caseId])).rows[0]
    await answerFollowup(s.ctx, s.client, s.caseId, fu.id, '問い合わせ獲得')
    await resolveFollowup(s.ctx, s.A.owner, fu.id, 'resolve', { applyToQuestion: true })
    st = await loadState(s.ctx.db, s.A.orgId, s.caseId)
    expect(st.answers.site_goal).toContain('問い合わせ獲得')
    expect(st.unresolvedAi).toBe(0)
    await runCaseAnalysis(s.ctx, s.A.orgId, s.caseId, s.A.owner)
    const done = await signoff(s.ctx, s.A.owner, s.caseId)
    expect(done.row.status).toBe('ready')
  })
})

describe('E2E-3 EC answer shows EC questions and hides recruiting (server side)', () => {
  it('progress denominator follows branching; hidden answers excluded from package', async () => {
    const s = await setup()
    await saveAnswers(s.ctx, s.client, s.caseId, { site_purpose: ['ec'], recruit_positions: '営業職' })
    const st = await loadState(s.ctx.db, s.A.orgId, s.caseId)
    expect(st.result.logic.visible.ec_product_count).toBe(true)
    expect(st.result.logic.visible.recruit_positions).toBe(false)
    expect(st.result.items.find((i) => i.itemId === 'q:recruit_positions')!.applicable).toBe(false)
    expect(st.answers.recruit_positions).toBe('営業職') // retained
    const pkg = await generatePackage(s.ctx, s.A.owner, s.caseId)
    expect(pkg.markdown).not.toContain('営業職')
  })
})

describe('#12 / #23 / E2E-5 AI OFF and per-file exclusion', () => {
  it('AI OFF (org) => zero provider calls', async () => {
    const spy = new SpyExternal()
    const s = await setup({ externalAi: spy, allowExternal: true })
    await updateSettings(s.ctx, s.A.owner, { aiEnabled: false })
    await saveAnswers(s.ctx, s.client, s.caseId, baseAnswers)
    await uploadFile(s.ctx, s.client, s.caseId, 'logo', 'logo.pdf', makePdf())
    await runJobsOnce(s.ctx)
    expect((await runCaseAnalysis(s.ctx, s.A.orgId, s.caseId, s.A.owner)).skipped).toBe('ai_disabled')
    expect(spy.calls.length).toBe(0)
    expect(Number((await s.ctx.db.one('SELECT count(*) AS n FROM ai_calls WHERE org_id=$1', [s.A.orgId])).n)).toBe(0)
  })
  it('AI OFF (case) => zero provider calls', async () => {
    const spy = new SpyExternal()
    const s = await setup({ externalAi: spy, allowExternal: true })
    await s.ctx.db.query('UPDATE cases SET ai_enabled=false WHERE id=$1', [s.caseId])
    await saveAnswers(s.ctx, s.client, s.caseId, baseAnswers)
    await runJobsOnce(s.ctx)
    expect(spy.calls.length).toBe(0)
  })
  it('confidential file excluded from AI => never sent to external provider', async () => {
    const spy = new SpyExternal()
    const s = await setup({ externalAi: spy, allowExternal: true })
    await saveAnswers(s.ctx, s.client, s.caseId, baseAnswers)
    // add a text reference file item for this test via a generic template? use logo item with a text-like pdf excluded at upload
    const up = await uploadFile(s.ctx, s.client, s.caseId, 'logo', 'secret.pdf', makePdf('CONFIDENTIAL-XYZ'), { aiExcluded: true })
    await runCaseAnalysis(s.ctx, s.A.orgId, s.caseId, s.A.owner)
    expect(spy.calls.filter((c) => c.kind === 'file').length).toBe(0)
    expect(JSON.stringify(spy.calls)).not.toContain('CONFIDENTIAL-XYZ')
    expect(JSON.stringify(spy.calls)).not.toContain(up.fileId)
    // excluding later removes AI index docs
    await s.ctx.db.query(`INSERT INTO ai_documents (org_id, case_id, source_type, source_id, content) VALUES ($1,$2,'file',$3,'secret text')`, [s.A.orgId, s.caseId, up.fileId])
    await setFileAiExcluded(s.ctx, s.A.owner, up.fileId, true)
    expect((await s.ctx.db.query(`SELECT * FROM ai_documents WHERE source_id=$1`, [up.fileId])).rowCount).toBe(0)
    // local provider is used when external transfer is not allowed by the operator
    const s2 = await setup({ externalAi: new SpyExternal(), allowExternal: false })
    await saveAnswers(s2.ctx, s2.client, s2.caseId, baseAnswers)
    await runCaseAnalysis(s2.ctx, s2.A.orgId, s2.caseId, s2.A.owner)
    expect((s2.ctx.ai.external as SpyExternal).calls.length).toBe(0)
  })
})

describe('#14 reminder de-duplication + quiet hours + failure', () => {
  it('same stage is planned once; quiet hours defer; missing-only content; failure notifies', async () => {
    const s = await setup()
    await saveAnswers(s.ctx, s.client, s.caseId, baseAnswers)
    const a = await planReminder(s.ctx, s.ctx.db, s.A.orgId, s.caseId)
    const b = await planReminder(s.ctx, s.ctx.db, s.A.orgId, s.caseId)
    await scanReminders(s.ctx)
    expect(a).toBeTruthy(); expect(b).toBeNull()
    expect((await s.ctx.db.query('SELECT * FROM reminders WHERE case_id=$1', [s.caseId])).rowCount).toBe(1)
    // quiet hours: 2026-10-05T13:00Z = 22:00 JST => scheduled at 08:00 JST next day
    s.clock.set('2026-10-06T13:00:00Z') // 2 days before target => no stage
    expect(await planReminder(s.ctx, s.ctx.db, s.A.orgId, s.caseId)).toBeNull()
    s.clock.set('2026-10-07T13:00:00Z') // 22:00 JST on 10-07, target 10-08 => before_1 not configured; due tomorrow
    s.clock.set('2026-10-08T13:30:00Z') // due date, 22:30 JST
    const due = await planReminder(s.ctx, s.ctx.db, s.A.orgId, s.caseId)
    const r = await s.ctx.db.one('SELECT * FROM reminders WHERE id=$1', [due])
    expect(r.stage).toBe('due')
    expect(new Date(r.scheduled_for).toISOString()).toBe('2026-10-08T23:00:00.000Z') // 08:00 JST
    // failure path
    s.email.failNext = 10
    await approveReminder(s.ctx, s.A.owner, due!)
    s.clock.set('2026-10-08T23:01:00Z')
    for (let i = 0; i < 8; i++) { await runJobsOnce(s.ctx); s.clock.advance(3 * 3600_000) }
    const em = await s.ctx.db.one('SELECT * FROM email_outbox WHERE case_id=$1 ORDER BY created_at DESC LIMIT 1', [s.caseId])
    expect(em.status).toBe('failed'); expect(em.attempts).toBe(4)
    expect((await s.ctx.db.query(`SELECT * FROM notifications WHERE type='reminder_failure'`)).rowCount).toBe(1)
    expect((await s.ctx.db.one('SELECT status FROM reminders WHERE id=$1', [due])).status).toBe('failed')
  })
  it('notification storm prevention coalesces events', async () => {
    const s = await setup()
    for (let i = 0; i < 20; i++) await notify(s.ctx.db, s.A.orgId, s.caseId, 'client_response', 'x', s.clock.now())
    const rows = (await s.ctx.db.query(`SELECT * FROM notifications WHERE type='client_response' AND case_id=$1`, [s.caseId])).rows
    expect(rows.length).toBe(1); expect(rows[0].count).toBe(20)
  })
})

describe('#15 / #16 Ready gate & override', () => {
  it('cannot sign off while conditions are unmet; override requires reason and records actor/time', async () => {
    const s = await setup()
    await saveAnswers(s.ctx, s.client, s.caseId, baseAnswers)
    await expect(signoff(s.ctx, s.A.owner, s.caseId)).rejects.toThrow(/Ready条件/)
    let st = await loadState(s.ctx.db, s.A.orgId, s.caseId)
    expect(st.row.status).not.toBe('ready')
    await expect(overrideReady(s.ctx, s.A.owner, s.caseId, '')).rejects.toThrow(/理由/)
    await expect(overrideReady(s.ctx, s.A.owner, s.caseId, 'ok')).rejects.toThrow(/理由/)
    const o = await overrideReady(s.ctx, s.A.owner, s.caseId, 'ロゴは後日支給で合意済み（電話確認）')
    expect(o.row.status).toBe('ready')
    st = await loadState(s.ctx.db, s.A.orgId, s.caseId)
    expect(st.row.ready_override.reason).toContain('合意済み')
    expect(st.row.ready_override.actorId).toBe(s.A.userId)
    expect(st.row.ready_override.at).toBe(s.clock.now().toISOString())
    const log = await s.ctx.db.one(`SELECT * FROM audit_logs WHERE action='case.ready_override' AND target_id=$1`, [s.caseId])
    expect(log.meta.unmet).toContain('ITEM_NOT_ACCEPTED')
  })
  it('uploads alone never make a case Ready (Upload != Accepted)', async () => {
    const s = await setup()
    await saveAnswers(s.ctx, s.client, s.caseId, baseAnswers)
    await uploadFile(s.ctx, s.client, s.caseId, 'logo', 'logo.pdf', makePdf())
    for (let i = 0; i < 5; i++) await uploadFile(s.ctx, s.client, s.caseId, 'product_images', `p${i}.png`, makePng(i, 1, 1))
    const st = await loadState(s.ctx.db, s.A.orgId, s.caseId)
    expect(st.result.progress.submitted).toBe(st.result.progress.denominator)
    expect(st.result.ready.ready).toBe(false)
    expect(st.row.status).toBe('needs_internal_review')
  })
})

describe('#17 / E2E-6 Ready re-evaluated after required change', () => {
  it('rejecting an accepted file after Ready revokes Ready and requires re-review', async () => {
    const s = await setup()
    await completeAll(s)
    expect((await signoff(s.ctx, s.A.owner, s.caseId)).row.status).toBe('ready')
    const f = await s.ctx.db.one(`SELECT id FROM files WHERE case_id=$1 AND item_id='logo'`, [s.caseId])
    await reviewFile(s.ctx, s.A.owner, f.id, 'reject', '解像度が低いためベクター形式で再提出をお願いします')
    const st = await loadState(s.ctx.db, s.A.orgId, s.caseId)
    expect(st.row.status).toBe('needs_client')
    expect(st.row.ready_at).toBeNull()
    expect(st.row.internal_signoff_at).toBeNull()
    expect(st.result.items.find((i) => i.itemId === 'logo')!.status).toBe('rejected')
    expect((await s.ctx.db.query(`SELECT * FROM audit_logs WHERE action='case.ready_revoked' AND target_id=$1`, [s.caseId])).rowCount).toBe(1)
    // client resubmits → needs review again, not ready until re-reviewed + signoff
    await uploadFile(s.ctx, s.client, s.caseId, 'logo', 'logo2.pdf', makePdf('v2'))
    expect((await loadState(s.ctx.db, s.A.orgId, s.caseId)).row.status).toBe('needs_internal_review')
  })
  it('changing a required answer after Ready revokes Ready; non-required change does not', async () => {
    const s = await setup()
    await completeAll(s)
    await signoff(s.ctx, s.A.owner, s.caseId)
    await saveAnswers(s.ctx, s.client, s.caseId, { budget_note: '予算は相談' })
    expect((await loadState(s.ctx.db, s.A.orgId, s.caseId)).row.status).toBe('ready')
    await saveAnswers(s.ctx, s.client, s.caseId, { company_address: '大阪府' })
    expect((await loadState(s.ctx.db, s.A.orgId, s.caseId)).row.status).not.toBe('ready')
  })
})

describe('#18 / #19 Intake package source references, no fabricated requirements', () => {
  it('every entry references an existing question / file / item; unknowns are open questions', async () => {
    const s = await setup()
    await saveAnswers(s.ctx, s.client, s.caseId, baseAnswers)
    await uploadFile(s.ctx, s.client, s.caseId, 'product_images', 'p.png', makePng(1, 1, 1))
    const { package: p } = await generatePackage(s.ctx, s.A.owner, s.caseId)
    const st = await loadState(s.ctx.db, s.A.orgId, s.caseId)
    const qids = new Set(st.def.questions.map((q) => q.id))
    const fids = new Set(st.files.map((f) => f.id))
    const all = [...Object.values(p.sections).flat(), ...p.handoff.blocks.flatMap((b) => b.entries)]
    expect(all.length).toBeGreaterThan(10)
    for (const e of all) {
      const r = e.source
      const ok = (r.questionId && qids.has(r.questionId)) || (r.fileId && fids.has(r.fileId)) || r.itemId || r.followupId || r.reviewId
      expect(ok, JSON.stringify(e)).toBeTruthy()
    }
    // requirements only contain answered/visible template questions — nothing invented
    for (const e of p.sections.requirements) expect(qids.has(e.source.questionId!)).toBe(true)
    expect(p.sections.openQuestions.map((e) => e.label)).toContain('ロゴデータ')
    expect(p.sections.objective[0].value).toBe('問い合わせを月20件に増やしたい')
    const unanswered = p.sections.audience[0]
    expect(unanswered.status).toBe('unknown'); expect(unanswered.value).toMatch(/Unknown/)
  })
})

describe('#20 Published template changes do not affect existing cases', () => {
  it('existing case keeps its version; new case uses the new version', async () => {
    const s = await setup()
    const tpl = await getTemplate(s.ctx, s.A.owner, s.t.templateId)
    const def = structuredClone(tpl.draft)
    def.questions.push({ id: 'new_q', sectionId: 's_company', type: 'short_text', label: '新しい必須質問', required: true })
    await updateDraft(s.ctx, s.A.owner, s.t.templateId, { definition: def })
    const v2 = await publishTemplate(s.ctx, s.A.owner, s.t.templateId)
    expect(v2.version).toBe(2)
    const old = await loadState(s.ctx.db, s.A.orgId, s.caseId)
    expect(old.def.questions.some((q) => q.id === 'new_q')).toBe(false)
    expect(old.result.progress.denominator).toBe(7)
    const c2 = await createCase(s.ctx, s.A.owner, { templateId: s.t.templateId, clientName: 'x', projectName: 'y' })
    expect((await loadState(s.ctx.db, s.A.orgId, c2)).def.questions.some((q) => q.id === 'new_q')).toBe(true)
    const v1 = await s.ctx.db.one('SELECT definition FROM template_versions WHERE template_id=$1 AND version=1', [s.t.templateId])
    expect(v1.definition.questions.some((q: any) => q.id === 'new_q')).toBe(false)
  })
  it('publishing a template with circular rules is refused', async () => {
    const s = await setup()
    const tpl = await getTemplate(s.ctx, s.A.owner, s.t.templateId)
    const def = structuredClone(tpl.draft)
    def.rules.push({ id: 'c1', when: { questionId: 'ec_shipping', op: 'answered' }, then: [{ type: 'show', target: 'ec_membership' }] })
    def.rules.push({ id: 'c2', when: { questionId: 'ec_membership', op: 'eq', value: 'yes' }, then: [{ type: 'hide', target: 'ec_shipping' }] })
    await updateDraft(s.ctx, s.A.owner, s.t.templateId, { definition: def })
    await expect(publishTemplate(s.ctx, s.A.owner, s.t.templateId)).rejects.toThrow(/公開できません/)
  })
})

describe('#24 deleted case is removed from AI index (and storage, search)', () => {
  it('deletes ai_documents, search_index and objects', async () => {
    const s = await setup()
    await saveAnswers(s.ctx, s.client, s.caseId, baseAnswers)
    const up = await uploadFile(s.ctx, s.client, s.caseId, 'logo', 'logo.pdf', makePdf())
    await s.ctx.db.query(`INSERT INTO ai_documents (org_id, case_id, source_type, source_id, content) VALUES ($1,$2,'file',$3,'text')`, [s.A.orgId, s.caseId, up.fileId])
    const key = (await s.ctx.db.one('SELECT storage_key FROM files WHERE id=$1', [up.fileId])).storage_key
    expect(await s.ctx.storage.get(key)).not.toBeNull()
    await deleteCase(s.ctx, s.A.owner, s.caseId)
    expect((await s.ctx.db.query('SELECT 1 FROM ai_documents WHERE case_id=$1', [s.caseId])).rowCount).toBe(0)
    expect((await s.ctx.db.query('SELECT 1 FROM search_index WHERE case_id=$1', [s.caseId])).rowCount).toBe(0)
    expect((await s.ctx.db.query('SELECT 1 FROM responses WHERE case_id=$1', [s.caseId])).rowCount).toBe(0)
    expect(await s.ctx.storage.get(key)).toBeNull()
    expect((await s.ctx.db.query(`SELECT 1 FROM audit_logs WHERE action='case.delete' AND target_id=$1`, [s.caseId])).rowCount).toBe(1)
  })
})

describe('#27 / E2E-8 Backup → empty environment restore keeps relations', () => {
  it('cases / responses / files metadata / packages / audit match after restore', async () => {
    const s = await setup()
    await completeAll(s)
    await signoff(s.ctx, s.A.owner, s.caseId)
    await generatePackage(s.ctx, s.A.owner, s.caseId)
    const before = await relationFingerprint(s.ctx.db, s.A.orgId)
    const { zip, manifest } = await exportOrg(s.ctx, s.A.owner)
    expect(manifest.schemaVersion).toBe(1); expect(manifest.appVersion).toBeTruthy(); expect(Object.keys(manifest.checksums).length).toBeGreaterThan(10)
    const empty = await makeCtx()
    const r = await restoreOrg(empty.ctx, zip)
    expect(r.fingerprintMatch).toBe(true)
    const { audit_logs: aAfter, ...after } = await relationFingerprint(empty.ctx.db, s.A.orgId)
    const { audit_logs: aBefore, ...beforeRest } = before
    expect(after).toEqual(beforeRest)
    expect(aAfter.count).toBe(aBefore.count + 1) // + restore.org entry
    const st = await loadState(empty.ctx.db, s.A.orgId, s.caseId)
    expect(st.row.status).toBe('ready'); expect(st.files.length).toBe(6)
    const f = await empty.ctx.db.one('SELECT storage_key, sha256 FROM files WHERE case_id=$1 LIMIT 1', [s.caseId])
    expect(await empty.ctx.storage.get(f.storage_key)).not.toBeNull()
    // owner can log in on the restored environment
    const { login } = await import('../src/server/services/orgs')
    await expect(login(empty.ctx, s.A.email, 'password-12345')).resolves.toBeTruthy()
    // restoring twice is refused
    await expect(restoreOrg(empty.ctx, zip)).rejects.toThrow(/存在/)
  })
  it('#25 restore rejects zip-slip entries and tampered checksums', async () => {
    const env = await makeCtx()
    const evil = zipSync({ 'manifest.json': strToU8(JSON.stringify({ format: 'intakemint.backup', schemaVersion: 1, checksums: {} })), '../../evil.txt': strToU8('x') })
    await expect(restoreOrg(env.ctx, evil)).rejects.toThrow(/不正なパス/)
    const tampered = zipSync({ 'manifest.json': strToU8(JSON.stringify({ format: 'intakemint.backup', schemaVersion: 1, orgId: crypto.randomUUID(), checksums: { 'data/cases.json': 'abc' } })), 'data/cases.json': strToU8('[]') })
    await expect(restoreOrg(env.ctx, tampered)).rejects.toThrow(/チェックサム/)
  })
})

describe('#29 / E2E-7 MCP: facts first, writes need confirmation', () => {
  it('answers "can this case start?" with facts and requires confirm for writes', async () => {
    const s = await setup()
    await saveAnswers(s.ctx, s.client, s.caseId, baseAnswers)
    for (let i = 0; i < 3; i++) await uploadFile(s.ctx, s.client, s.caseId, 'product_images', `p${i}.png`, makePng(i, 1, 1))
    const { token } = await createApiToken(s.ctx, s.A.owner, 'claude-code')
    const { resolveApiToken } = await import('../src/server/services/orgs')
    const mcpActor = (await resolveApiToken(s.ctx.db, token))!
    const status: any = await callTool(s.ctx, mcpActor, 'get_intake_status', { caseId: s.caseId })
    expect(status.canStart).toBe(false)
    expect(status.blockingReasons.join()).toContain('ロゴデータ: 未提出')
    expect(status.blockingReasons.join()).toContain('（3/5）')
    const missing: any = await callTool(s.ctx, mcpActor, 'get_missing_items', { caseId: s.caseId })
    expect(missing.missing.map((m: any) => m.label)).toEqual(['ロゴデータ', '商品・サービス画像'])
    // write without confirm => preview only, nothing changed
    const pv: any = await callTool(s.ctx, mcpActor, 'request_more_information', { caseId: s.caseId, text: 'ロゴのAIデータはありますか？' })
    expect(pv.requiresConfirmation).toBe(true)
    expect((await s.ctx.db.query('SELECT 1 FROM followups WHERE case_id=$1', [s.caseId])).rowCount).toBe(0)
    const pv2: any = await callTool(s.ctx, mcpActor, 'draft_reminder', { caseId: s.caseId })
    expect(pv2.requiresConfirmation).toBe(true)
    expect((await s.ctx.db.query('SELECT 1 FROM reminders WHERE case_id=$1', [s.caseId])).rowCount).toBe(0)
    const ok: any = await callTool(s.ctx, mcpActor, 'request_more_information', { caseId: s.caseId, text: 'ロゴのAIデータはありますか？', confirm: true })
    expect(ok.followupId).toBeTruthy()
    expect(s.email.sent.length).toBe(0) // MCP never sends email
    // after everything is collected → package
    await uploadFile(s.ctx, s.client, s.caseId, 'logo', 'logo.pdf', makePdf())
    for (let i = 3; i < 5; i++) await uploadFile(s.ctx, s.client, s.caseId, 'product_images', `p${i}.png`, makePng(i, 1, 1))
    await answerFollowup(s.ctx, s.client, s.caseId, ok.followupId, 'PDFで提出しました')
    await resolveFollowup(s.ctx, s.A.owner, ok.followupId, 'resolve')
    await runCaseAnalysis(s.ctx, s.A.orgId, s.caseId, s.A.owner)
    await callTool(s.ctx, mcpActor, 'review_response', { caseId: s.caseId, itemId: 'logo', decision: 'accept', confirm: true })
    await callTool(s.ctx, mcpActor, 'review_response', { caseId: s.caseId, itemId: 'product_images', decision: 'accept', confirm: true })
    await signoff(s.ctx, s.A.owner, s.caseId)
    expect(((await callTool(s.ctx, mcpActor, 'get_intake_status', { caseId: s.caseId })) as any).canStart).toBe(true)
    const pkg: any = await callTool(s.ctx, mcpActor, 'generate_intake_package', { caseId: s.caseId, confirm: true })
    expect(pkg.ready).toBe(true); expect(pkg.markdown).toContain('案件開始パック')
    expect((await s.ctx.db.query(`SELECT 1 FROM audit_logs WHERE action LIKE 'mcp.%'`)).rowCount).toBeGreaterThanOrEqual(3)
    // tenant isolation for MCP tokens
    const B = await makeOrg(s.ctx, 'Other')
    const { token: tb } = await createApiToken(s.ctx, B.owner, 'b')
    const bActor = (await resolveApiToken(s.ctx.db, tb))!
    await expect(callTool(s.ctx, bActor, 'get_intake_status', { caseId: s.caseId })).rejects.toThrow(/見つかりません/)
  })
  it('MCP server lists all tools with JSON schemas and annotations', async () => {
    const s = await setup()
    const { token } = await createApiToken(s.ctx, s.A.owner, 'x')
    const server = createMcpServer(s.ctx, token)
    expect(server).toBeTruthy()
    const names = TOOLS.map((t) => t.name)
    for (const n of ['create_intake', 'get_intake_status', 'get_missing_items', 'review_response', 'request_more_information', 'get_ready_cases', 'generate_intake_package', 'search_intakes', 'prepare_handoff']) expect(names).toContain(n)
    expect(TOOLS.filter((t) => t.write).every((t) => 'confirm' in t.input.shape)).toBe(true)
  })
})

describe('recompute is idempotent', () => {
  it('re-running recompute does not change state', async () => {
    const s = await setup()
    await saveAnswers(s.ctx, s.client, s.caseId, baseAnswers)
    const a = await recompute(s.ctx, s.ctx.db, s.A.orgId, s.caseId, s.A.owner)
    const b = await recompute(s.ctx, s.ctx.db, s.A.orgId, s.caseId, s.A.owner)
    expect(b.row.status).toBe(a.row.status); expect(b.result.progress).toEqual(a.result.progress)
  })
})
