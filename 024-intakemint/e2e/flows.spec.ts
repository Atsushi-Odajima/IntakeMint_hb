// Browser E2E: required test #28 (iPhone PWA upload flow), E2E-3 (UI branching), E2E-4 (phone upload → PC review), PWA manifest/SW.
import { test, expect, type Page, type Browser } from '@playwright/test'
import zlib from 'node:zlib'

const OWNER = { email: 'owner@sample-creative.example', password: 'sample-demo-password' }

function png(r: number, g: number, b: number): Buffer {
  const crc = (buf: Buffer) => { let c = ~0; for (const x of buf) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)) } return ~c >>> 0 }
  const chunk = (t: string, d: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]) }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(8, 0); ih.writeUInt32BE(8, 4); ih[8] = 8; ih[9] = 2
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(24).map((_, i) => [r, g, b][i % 3])])
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(Buffer.concat(Array(8).fill(row)))), chunk('IEND', Buffer.alloc(0))])
}

async function login(page: Page) {
  await page.goto('/login')
  await page.getByLabel('メールアドレス').fill(OWNER.email)
  await page.getByLabel('パスワード').fill(OWNER.password)
  await page.getByRole('button', { name: 'ログイン' }).click()
  await expect(page.getByRole('heading', { name: '案件の準備状況' })).toBeVisible()
}

/** Create a fresh case through the API (as owner) and return a client link. */
async function newCaseLink(browser: Browser, baseURL: string, name: string): Promise<{ caseId: string; url: string }> {
  const ctx = await browser.newContext({ baseURL })
  const r = await ctx.request.post('/api/auth/login', { data: OWNER })
  const { csrf } = await r.json()
  const h = { 'x-csrf-token': csrf }
  const tpl = (await (await ctx.request.get('/api/templates')).json()).find((t: any) => t.status === 'published')
  const { id } = await (await ctx.request.post('/api/cases', { data: { templateId: tpl.id, clientName: `${name}株式会社`, projectName: `${name} サイト制作`, clientEmail: 'c@example.test', targetReadyDate: '2030-01-10' }, headers: h })).json()
  const link = await (await ctx.request.post(`/api/cases/${id}/links`, { data: {}, headers: h })).json()
  await ctx.close()
  return { caseId: id, url: new URL(link.url).pathname }
}

test('PWA: manifest, icons and service worker are served', async ({ page, request }) => {
  const m = await (await request.get('/manifest.webmanifest')).json()
  expect(m.display).toBe('standalone')
  expect(m.icons.map((i: any) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']))
  expect(m.icons.some((i: any) => i.purpose === 'maskable')).toBe(true)
  expect((await request.get('/icons/icon-512.png')).status()).toBe(200)
  expect((await request.get('/icons/apple-touch-icon.png')).status()).toBe(200)
  const sw = await (await request.get('/sw.js')).text()
  expect(sw).toContain("url.pathname.startsWith('/api/')") // API never cached
  await page.goto('/login')
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest')
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', /viewport-fit=cover/)
  const reg = await page.evaluate(async () => { const r = await navigator.serviceWorker.ready; return !!r.active })
  expect(reg).toBe(true)
})

test('E2E-3 / #6 UI: choosing EC shows EC questions; recruiting stays hidden; progress denominator grows', async ({ page, browser, baseURL }) => {
  const { url } = await newCaseLink(browser, baseURL!, 'Branch')
  await page.goto(url)
  await expect(page.getByText(/必要な情報 7件中 0件/)).toBeVisible()
  // client home-screen install reopens this portal link, not the staff app
  const href = await page.locator('link[rel="manifest"]').getAttribute('href')
  expect(href).toBe(`/api/portal/${url.split('/p/')[1]}/manifest.webmanifest`)
  const pm = await (await page.request.get(href!)).json()
  expect(pm.start_url).toBe(url)
  await expect(page.getByText('掲載する商品数')).toHaveCount(0)
  await page.getByRole('checkbox', { name: 'ネット販売（EC）' }).click()
  await expect(page.getByText('掲載する商品数')).toBeVisible()
  await expect(page.getByText('希望する決済方法')).toBeVisible()
  await expect(page.getByText('募集職種')).toHaveCount(0)
  await expect(page.getByText(/必要な情報 9件中/)).toBeVisible({ timeout: 10_000 }) // after autosave
})

test('#28 / E2E-4: client uploads photo + PDF on a phone-sized PWA, saves, then PC staff reviews', async ({ page, browser, baseURL }, info) => {
  const { caseId, url } = await newCaseLink(browser, baseURL!, `Upload-${info.project.name}`)
  await page.goto(url)
  await page.getByLabel('会社名').fill('株式会社アップロード')
  await page.getByLabel('所在地').fill('東京都港区1-1-1')
  // product images: 3 photos (camera roll on iPhone == file input with image/*)
  const imgInput = page.getByTestId('file-product_images')
  await expect(imgInput).toHaveAttribute('accept', /image\/\*/)
  await imgInput.setInputFiles([1, 2, 3].map((i) => ({ name: `IMG_000${i}.png`, mimeType: 'image/png', buffer: png(i * 40, 120, 90) })))
  await expect(page.getByText('IMG_0003.png')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText(/商品・サービス画像（3\/5）/)).toBeVisible()
  // logo as PDF
  await page.getByTestId('file-logo').setInputFiles({ name: 'logo.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF\n') })
  await expect(page.getByText('logo.pdf')).toBeVisible({ timeout: 20_000 })
  // invalid file is rejected with a message
  await page.getByTestId('file-logo').setInputFiles({ name: 'fake.png', mimeType: 'image/png', buffer: Buffer.from('not really a png') })
  await expect(page.getByText(/拡張子|受け付けます/)).toBeVisible()
  await page.getByRole('button', { name: '保存して終了' }).click()
  await expect(page.getByText(/保存しました/).first()).toBeVisible()
  // resume later from the same link: data persisted
  await page.reload()
  await expect(page.getByLabel('会社名')).toHaveValue('株式会社アップロード')

  // PC staff reviews
  const pc = await browser.newContext({ baseURL, viewport: { width: 1360, height: 900 } })
  const p2 = await pc.newPage()
  await login(p2)
  await p2.goto(`/app/cases/${caseId}`)
  await expect(p2.getByText('IMG_0001.png')).toBeVisible()
  const logoRow = p2.locator('.file-pill', { hasText: 'logo.pdf' })
  await logoRow.getByRole('button', { name: '承認' }).click()
  await expect(p2.locator('.file-pill', { hasText: 'logo.pdf' }).getByText('承認済み')).toBeVisible()
  await p2.locator('.file-pill', { hasText: 'IMG_0001.png' }).getByRole('button', { name: '差戻' }).click()
  await p2.getByLabel(/理由/).fill('ピントが合っていないため撮り直しをお願いします')
  await p2.getByRole('button', { name: 'OK', exact: true }).click()
  await expect(p2.locator('.file-pill', { hasText: 'IMG_0001.png' }).getByText('差し戻し')).toBeVisible()
  await pc.close()
  // client sees the rejection reason
  await page.reload()
  await expect(page.getByText(/ピントが合っていない/)).toBeVisible()
})

test('Offline: answers kept as local draft, upload & submit disabled until online', async ({ page, context, browser, baseURL }) => {
  const { url } = await newCaseLink(browser, baseURL!, 'Offline')
  await page.goto(url)
  await expect(page.getByText(/必要な情報 \d+件中/)).toBeVisible()
  await context.setOffline(true)
  await page.evaluate(() => window.dispatchEvent(new Event('offline')))
  await expect(page.getByText(/オフラインです/)).toBeVisible()
  await page.getByLabel('会社名').fill('オフライン株式会社')
  await expect(page.getByRole('button', { name: /送信する/ })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'ファイルを選択 / 撮影' }).first()).toBeDisabled()
  await page.getByRole('button', { name: '保存して終了' }).click()
  await expect(page.getByText(/下書きとして保存/)).toBeVisible()
  await context.setOffline(false)
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect(page.getByText(/自動保存しました/)).toBeVisible({ timeout: 15_000 })
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await expect(page.getByLabel('会社名')).toHaveValue('オフライン株式会社')
})

test('Internal flow on device: dashboard, Ready gate visible, AI candidates are candidates', async ({ page }) => {
  await login(page)
  await page.goto('/app/cases')
  await page.getByLabel('絞り込み').fill('コーポレートサイト制作')
  await page.locator('.case-card', { hasText: '株式会社サンプル コーポレートサイト制作' }).first().click()
  await expect(page.getByRole('heading', { name: 'Ready判定' })).toBeVisible()
  await expect(page.getByText(/ロゴデータ: 未提出/)).toBeVisible()
  await page.getByRole('tab', { name: /AI確認/ }).click()
  await expect(page.getByText(/全25商品/)).toBeVisible()
  await expect(page.getByText('AIの指摘は「候補」です', { exact: false })).toBeVisible()
  // horizontal overflow check (no sideways scrolling on phones)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})

test('Ready case → Developer Handoff package for Claude Code', async ({ page }) => {
  await login(page)
  await page.goto('/app/cases')
  await page.getByLabel('絞り込み').fill('サンプル商店')
  await page.locator('.case-card', { hasText: 'サンプル商店 Webサイトリニューアル' }).first().click()
  await expect(page.getByText('開始できます')).toBeVisible()
  await page.getByRole('tab', { name: '案件開始パック' }).click()
  await page.getByLabel('Handoffプロファイル').selectOption('web_development')
  await page.getByRole('button', { name: 'パックを生成' }).click()
  await expect(page.locator('pre.md')).toContainText('Web Development Handoff')
  await expect(page.locator('pre.md')).toContainText('[q:site_goal]')
})
