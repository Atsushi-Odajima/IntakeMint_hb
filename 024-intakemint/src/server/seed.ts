// Sample workspace seed (fictional "Sample Creative Studio"). Marked is_sample=true and only created
// when SEED_SAMPLE=true / `npm run seed`. Never enable on a production tenant (see OPERATIONS.md).
import zlib from 'node:zlib'
import type { Ctx, Actor } from './services/context'
import { signup } from './services/orgs'
import { createTemplate, publishTemplate } from './services/templates'
import { createCase, recompute } from './services/cases'
import { issueLink } from './services/access'
import { saveAnswers, uploadFile } from './services/intake'
import { runCaseAnalysis } from './services/ai'
import { reviewItem, signoff } from './services/review'
import { planReminder } from './services/reminders'
import { generatePackage } from './services/packages'

function crc32(buf: Buffer): number {
  let c = ~0
  for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)) }
  return ~c >>> 0
}
/** Tiny valid PNG (solid color) for sample uploads. */
export function makePng(r: number, g: number, b: number, size = 16): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data])
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3).map((_, i) => [r, g, b][i % 3])])
  const raw = Buffer.concat(Array.from({ length: size }, () => row))
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
export const makePdf = (text = 'sample') => Buffer.from(`%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n% ${text}\ntrailer<<>>\n%%EOF\n`)

const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400_000).toISOString().slice(0, 10)

export const SAMPLE_EMAIL = 'owner@sample-creative.example'

export async function seedSample(ctx: Ctx, opts: { password?: string } = {}): Promise<{ created: boolean; orgId?: string; email: string; password: string; caseIds?: Record<string, string> }> {
  const password = opts.password ?? process.env.SEED_PASSWORD ?? 'sample-demo-password'
  const existing = await ctx.db.one('SELECT id FROM users WHERE lower(email)=lower($1)', [SAMPLE_EMAIL])
  if (existing) return { created: false, email: SAMPLE_EMAIL, password }
  const { orgId, userId } = await signup(ctx, { orgName: 'Sample Creative Studio（架空）', email: SAMPLE_EMAIL, name: 'サンプル 太郎', password })
  await ctx.db.query(`UPDATE organizations SET is_sample=true, settings=$2 WHERE id=$1`, [orgId, JSON.stringify({ branding: { color: '#0F2D2A', senderName: 'Sample Creative Studio' } })])
  const owner: Actor = { type: 'user', orgId, userId, role: 'owner' }
  const ws = await ctx.db.one('SELECT id FROM workspaces WHERE org_id=$1', [orgId])
  const t = await createTemplate(ctx, owner, { workspaceId: ws.id, name: 'Web制作（コーポレートサイト）', sampleKey: 'web' })
  await publishTemplate(ctx, owner, t.id)
  const today = ctx.now()

  // Case 1: in progress — logo missing, images 3/5, vague answer, EC branch, contradiction, reminder draft.
  const c1 = await createCase(ctx, owner, { templateId: t.id, clientName: '株式会社サンプル', clientEmail: 'client@sample-corp.example', projectName: '株式会社サンプル コーポレートサイト制作', targetReadyDate: addDays(today, 3) })
  await issueLink(ctx, owner, c1, { days: 30 })
  const client1: Actor = { type: 'client', orgId, caseId: c1 }
  await saveAnswers(ctx, client1, c1, {
    company_name: '株式会社サンプル', company_address: '東京都千代田区サンプル1-2-3', ceo_message: '私たちは地域のお客様に信頼される会社を目指し、日々サービスの品質向上に取り組んでいます。今回のサイトを通じて、より多くの方に私たちの想いを届けたいと考えています。',
    site_purpose: ['company', 'inquiry', 'ec'], site_goal: '会社のサイトです', business_description: 'オリジナル雑貨の企画・製造・販売。',
    requests: '全25商品を掲載したいです。落ち着いた雰囲気にしたい。', ec_product_count: 10, ec_payment: ['card', 'bank'],
    reference_sites: [{ url: 'https://example.com/', reason: '余白の多いデザイン' }, { url: 'https://example.org/' }],
    contact_name: 'サンプル 花子', contact_email: 'client@sample-corp.example', privacy_ack: true,
  })
  for (const [i, col] of [[0, [60, 179, 113]], [1, [15, 45, 42]], [2, [232, 225, 214]]] as const) {
    await uploadFile(ctx, client1, c1, 'product_images', `product_${i + 1}.png`, makePng(col[0], col[1], col[2]))
  }
  await runCaseAnalysis(ctx, orgId, c1, { type: 'system', orgId })
  await recompute(ctx, ctx.db, orgId, c1, owner)
  await planReminder(ctx, ctx.db, orgId, c1)

  // Case 2: Ready with Developer Handoff package.
  const c2 = await createCase(ctx, owner, { templateId: t.id, clientName: 'サンプル商店', clientEmail: 'shop@sample-shop.example', projectName: 'サンプル商店 Webサイトリニューアル', targetReadyDate: addDays(today, 10) })
  await issueLink(ctx, owner, c2, { days: 30 })
  const client2: Actor = { type: 'client', orgId, caseId: c2 }
  await saveAnswers(ctx, client2, c2, {
    company_name: 'サンプル商店', company_address: '大阪府大阪市サンプル町4-5-6', ceo_message: '創業以来、手づくりの品質にこだわってきました。これからも一つひとつ丁寧にお届けします。新しいサイトで私たちの商品の魅力をお伝えします。',
    site_purpose: ['company', 'inquiry'], site_goal: '問い合わせを月20件に増やし、法人の大口注文につなげたい', business_description: '無垢材を使った手づくり家具の製造販売と、店舗内装の施工を行っています。',
    target_audience: '30〜50代の住宅購入層、法人の店舗内装担当', reference_sites: [{ url: 'https://example.net/', reason: '施工事例の見せ方' }],
    contact_name: 'サンプル 次郎', contact_email: 'shop@sample-shop.example', privacy_ack: true, launch_date: addDays(today, 60),
  })
  await uploadFile(ctx, client2, c2, 'logo', 'logo.pdf', makePdf('logo'))
  for (let i = 0; i < 5; i++) await uploadFile(ctx, client2, c2, 'product_images', `works_${i + 1}.png`, makePng(40 + i * 30, 120, 100))
  await runCaseAnalysis(ctx, orgId, c2, { type: 'system', orgId })
  await reviewItem(ctx, owner, c2, 'logo', 'accept')
  await reviewItem(ctx, owner, c2, 'product_images', 'accept')
  await signoff(ctx, owner, c2, 'サンプル：全項目確認済み')
  await generatePackage(ctx, owner, c2, 'web_development')

  // Case 3: new (draft) case.
  const c3 = await createCase(ctx, owner, { templateId: t.id, clientName: 'サンプル採用株式会社', projectName: 'サンプル採用株式会社 採用サイト制作', targetReadyDate: addDays(today, 20) })
  return { created: true, orgId, email: SAMPLE_EMAIL, password, caseIds: { inProgress: c1, ready: c2, draft: c3 } }
}
