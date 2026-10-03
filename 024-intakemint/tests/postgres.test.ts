// Runs the core flow against a real PostgreSQL server (skipped unless TEST_DATABASE_URL / TEST_DATABASE_URL2 are set).
// e.g. TEST_DATABASE_URL=postgres://intakemint:devpass@localhost/intakemint_test TEST_DATABASE_URL2=.../intakemint_test2
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createPostgresDb, migrate, type Db } from '../src/server/db'
import { createCtx } from '../src/server/ctx'
import { LocalStorage } from '../src/server/storage'
import { Clock, makeOrg, webTemplate } from './helpers'
import { createCase, loadState } from '../src/server/services/cases'
import { issueLink } from '../src/server/services/access'
import { saveAnswers, uploadFile } from '../src/server/services/intake'
import { reviewItem, signoff } from '../src/server/services/review'
import { runCaseAnalysis } from '../src/server/services/ai'
import { generatePackage } from '../src/server/services/packages'
import { exportOrg, restoreOrg } from '../src/server/services/backup'
import { search } from '../src/server/services/search'
import { makePdf, makePng } from '../src/server/seed'

const URL1 = process.env.TEST_DATABASE_URL, URL2 = process.env.TEST_DATABASE_URL2

async function fresh(url: string): Promise<Db> {
  const db = await createPostgresDb(url)
  await db.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
  await migrate(db)
  return db
}
async function ctxFor(db: Db) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'im-pg-'))
  return createCtx({ db, storage: new LocalStorage(dir), now: new Clock().now, config: { env: 'test', signingSecret: 'x'.repeat(40), storageDir: dir } })
}

describe.skipIf(!URL1 || !URL2)('real PostgreSQL', () => {
  it('flow + search + backup/restore on PostgreSQL', async () => {
    const ctx = await ctxFor(await fresh(URL1!))
    const A = await makeOrg(ctx, 'PgOrg')
    const t = await webTemplate(ctx, A.owner, A.workspaceId)
    const caseId = await createCase(ctx, A.owner, { templateId: t.templateId, clientName: 'PG株式会社', projectName: 'PostgreSQL検証案件', clientEmail: 'pg@example.test' })
    await issueLink(ctx, A.owner, caseId)
    const client = { type: 'client' as const, orgId: A.orgId, caseId }
    await saveAnswers(ctx, client, caseId, {
      company_name: 'PG株式会社', company_address: '東京都', ceo_message: '代表挨拶の本文です。お客様に信頼される会社を目指します。', site_purpose: ['company'],
      site_goal: '問い合わせを月20件に増やしたい', business_description: 'オリジナル雑貨の企画・製造・オンライン販売を行っています。',
      reference_sites: [{ url: 'https://example.com/', reason: '余白' }], contact_name: '花子', contact_email: 'h@example.test', privacy_ack: true,
    })
    await uploadFile(ctx, client, caseId, 'logo', 'logo.pdf', makePdf())
    for (let i = 0; i < 5; i++) await uploadFile(ctx, client, caseId, 'product_images', `p${i}.png`, makePng(i, 1, 1))
    await runCaseAnalysis(ctx, A.orgId, caseId, A.owner)
    await reviewItem(ctx, A.owner, caseId, 'logo', 'accept')
    await reviewItem(ctx, A.owner, caseId, 'product_images', 'accept')
    expect((await signoff(ctx, A.owner, caseId)).row.status).toBe('ready')
    await generatePackage(ctx, A.owner, caseId)
    expect((await search(ctx, A.owner, '検証案件')).length).toBeGreaterThan(0)
    const { zip } = await exportOrg(ctx, A.owner)
    const ctx2 = await ctxFor(await fresh(URL2!))
    const r = await restoreOrg(ctx2, zip)
    expect(r.fingerprintMatch).toBe(true)
    expect((await loadState(ctx2.db, A.orgId, caseId)).row.status).toBe('ready')
    await ctx.db.close(); await ctx2.db.close()
  })
})
