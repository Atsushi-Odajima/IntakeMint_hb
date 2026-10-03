// Performance measurement: 10 / 100 / 1000 cases per org (+ a 50k-case synthetic scale check).
// DATABASE_URL=postgres://... npm run perf   (falls back to PGlite when unset). Results -> docs/perf-results.json
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { createPgliteDb, createPostgresDb, migrate, type Db } from '../src/server/db'
import { createCtx } from '../src/server/ctx'
import { LocalStorage } from '../src/server/storage'
import { signup } from '../src/server/services/orgs'
import { createTemplate, publishTemplate } from '../src/server/services/templates'
import { createCase, dashboard, recompute } from '../src/server/services/cases'
import { saveAnswers, uploadFile } from '../src/server/services/intake'
import { search } from '../src/server/services/search'
import { generatePackage } from '../src/server/services/packages'
import { scanReminders } from '../src/server/services/reminders'
import { makePng } from '../src/server/seed'
import type { Actor } from '../src/server/services/context'

const url = process.env.DATABASE_URL
async function freshDb(): Promise<Db> {
  if (!url) { const d = await createPgliteDb(); await migrate(d); return d }
  const d = await createPostgresDb(url); await d.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;'); await migrate(d); return d
}
const t = async <T>(fn: () => Promise<T>, n = 5) => { const xs: number[] = []; let r: T; for (let i = 0; i < n; i++) { const s = performance.now(); r = await fn(); xs.push(performance.now() - s) } xs.sort((a, b) => a - b); return { p50: +xs[Math.floor(n / 2)].toFixed(1), max: +xs[n - 1].toFixed(1), result: r! } }

const answers = (i: number) => ({
  company_name: `株式会社テスト${i}`, company_address: '東京都千代田区', ceo_message: '代表挨拶の本文です。お客様に信頼される会社を目指します。', site_purpose: ['company', 'inquiry'],
  site_goal: '問い合わせを月20件に増やしたい', business_description: 'オリジナル雑貨の企画・製造・オンライン販売を行っています。', reference_sites: [{ url: 'https://example.com/', reason: '余白' }],
  contact_name: '担当', contact_email: `c${i}@example.test`, privacy_ack: true,
})

const results: any = { db: url ? 'postgres' : 'pglite', date: new Date().toISOString(), node: process.version, scales: [] }
for (const N of [10, 100, 1000]) {
  const db = await freshDb()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'im-perf-'))
  const ctx = await createCtx({ db, storage: new LocalStorage(dir), config: { env: 'test', signingSecret: 'x'.repeat(40), storageDir: dir } })
  const { orgId, userId } = await signup(ctx, { orgName: 'Perf', email: `perf${N}@example.test`, name: 'P', password: 'password-12345' })
  const owner: Actor = { type: 'user', orgId, userId, role: 'owner' }
  const ws = await db.one('SELECT id FROM workspaces WHERE org_id=$1', [orgId])
  const tpl = await createTemplate(ctx, owner, { workspaceId: ws.id, name: 'Web', sampleKey: 'web' })
  await publishTemplate(ctx, owner, tpl.id)
  const s0 = performance.now()
  const ids: string[] = []
  for (let i = 0; i < N; i++) {
    const id = await createCase(ctx, owner, { templateId: tpl.id, clientName: `クライアント${i}`, projectName: `案件${i} サイト制作`, targetReadyDate: '2026-10-08' })
    ids.push(id)
    if (i % 2 === 0) await saveAnswers(ctx, { type: 'client', orgId, caseId: id }, id, answers(i))
  }
  const createMs = performance.now() - s0
  // file metadata volume (10 per case) without blobs
  await db.query(`INSERT INTO files (org_id, case_id, item_id, original_name, storage_key, mime, ext, size, sha256, uploaded_by_kind)
    SELECT c.org_id, c.id, 'product_images', 'img_' || g || '.png', c.org_id::text || '/' || c.id::text || '/' || g, 'image/png', 'png', 1000, md5(g::text), 'client' FROM cases c, generate_series(1,10) g WHERE c.org_id=$1`, [orgId])
  const dash = await t(() => dashboard(ctx, owner))
  const srch = await t(() => search(ctx, owner, 'テスト7'))
  const pkg = await t(() => generatePackage(ctx, owner, ids[0]), 3)
  const rec = await t(() => recompute(ctx, db, orgId, ids[0], owner), 5)
  const up = await t(() => uploadFile(ctx, owner, ids[1], 'logo', 'logo.png', makePng(1, 2, 3)), 3)
  const scan = await t(() => scanReminders(ctx), 1)
  results.scales.push({ cases: N, createAndAnswerTotalMs: Math.round(createMs), perCaseMs: +(createMs / N).toFixed(1), dashboardMs: dash, searchMs: srch, packageMs: pkg, recomputeMs: rec, uploadMs: up, reminderScanMs: { ...scan, planned: scan.result } })
  console.log(N, JSON.stringify(results.scales.at(-1), (k, v) => (k === 'result' ? undefined : v)))
  await db.close()
}

// Synthetic scale: 50,000 cases / 600,000 responses / 500,000 file rows in one org — index usage check.
{
  const db = await freshDb()
  const org = await db.one(`INSERT INTO organizations (name, slug) VALUES ('Big','big') RETURNING id`)
  const ws = await db.one(`INSERT INTO workspaces (org_id, name) VALUES ($1,'w') RETURNING id`, [org.id])
  const tp = await db.one(`INSERT INTO templates (org_id, workspace_id, name, draft) VALUES ($1,$2,'t','{}') RETURNING id`, [org.id, ws.id])
  const v = await db.one(`INSERT INTO template_versions (org_id, template_id, version, name, definition) VALUES ($1,$2,1,'t','{}') RETURNING id`, [org.id, tp.id])
  const s = performance.now()
  const statuses = `(ARRAY['draft','sent','in_progress','needs_client','needs_internal_review','ready','started','archived'])[1 + (g % 8)]`
  await db.query(`INSERT INTO cases (org_id, workspace_id, template_version_id, client_name, project_name, status, target_ready_date, last_activity_at)
    SELECT $1, $2, $3, 'client ' || g, 'project ' || g, ${statuses}, current_date + (g % 60) - 30, now() - (g || ' minutes')::interval FROM generate_series(1, 50000) g`, [org.id, ws.id, v.id])
  await db.query(`INSERT INTO responses (org_id, case_id, question_id, value, updated_by_kind) SELECT c.org_id, c.id, 'q' || g, '"answer"'::jsonb, 'client' FROM cases c, generate_series(1,12) g WHERE c.org_id=$1`, [org.id])
  await db.query(`INSERT INTO files (org_id, case_id, item_id, original_name, storage_key, mime, ext, size, sha256, uploaded_by_kind) SELECT c.org_id, c.id, 'i', 'f.png', c.id::text || g, 'image/png', 'png', 1, 'x', 'client' FROM cases c, generate_series(1,10) g WHERE c.org_id=$1`, [org.id])
  await db.query(`INSERT INTO search_index (entity_type, entity_id, org_id, case_id, title, body) SELECT 'case', id::text, org_id, id, project_name || ' ' || client_name, '' FROM cases WHERE org_id=$1`, [org.id])
  await db.query('ANALYZE')
  const loadMs = performance.now() - s
  const ctx = await createCtx({ db, config: { env: 'test', signingSecret: 'x'.repeat(40) } })
  const actor: Actor = { type: 'system', orgId: org.id }
  const dash = await t(() => dashboard(ctx, actor))
  const srch = await t(() => search(ctx, { ...actor, type: 'user', role: 'viewer' }, 'project 4999'))
  const one = await t(() => db.query(`SELECT count(*) FROM responses WHERE case_id=(SELECT id FROM cases WHERE org_id=$1 LIMIT 1)`, [org.id]))
  const plan = (await db.query(`EXPLAIN SELECT id FROM cases WHERE org_id=$1 AND status='needs_internal_review' ORDER BY last_activity_at DESC LIMIT 20`, [org.id])).rows.map((r) => Object.values(r)[0]).join(' | ')
  results.synthetic = { cases: 50000, responses: 600000, files: 500000, loadMs: Math.round(loadMs), dashboardMs: dash, searchMs: srch, responsesByCaseMs: one, dashboardPlan: plan }
  console.log('synthetic', JSON.stringify(results.synthetic, (k, v) => (k === 'result' ? undefined : v)))
  await db.close()
}
fs.mkdirSync('docs', { recursive: true })
fs.writeFileSync(`docs/perf-results-${results.db}.json`, JSON.stringify(results, (k, v) => (k === 'result' ? undefined : v), 2))
