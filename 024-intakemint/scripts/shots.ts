// Screenshot tour (desktop / iPad / iPhone / Android) of a running server with the sample seed.
import { chromium, devices } from '@playwright/test'
const base = process.env.BASE ?? 'http://localhost:8787'
const out = process.env.OUT ?? 'docs/screenshots'
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
async function login(page: any) {
  await page.goto(base + '/login')
  await page.getByLabel('メールアドレス').fill('owner@sample-creative.example')
  await page.getByLabel('パスワード').fill('sample-demo-password')
  await page.getByRole('button', { name: 'ログイン' }).click()
  await page.waitForURL('**/app')
  await page.getByText('案件の準備状況').waitFor()
}
const profiles: [string, any][] = [['desktop', { viewport: { width: 1360, height: 900 } }], ['ipad', devices['iPad (gen 7)']], ['iphone', devices['iPhone 13']], ['android', devices['Pixel 7']]]
for (const [name, dev] of profiles) {
  const ctx = await browser.newContext({ ...dev, locale: 'ja-JP' })
  const page = await ctx.newPage()
  await login(page)
  await page.screenshot({ path: `${out}/${name}-dashboard.png`, fullPage: name === 'desktop' })
  await page.getByText('株式会社サンプル コーポレートサイト制作').first().click()
  await page.getByText('Ready判定').waitFor()
  await page.screenshot({ path: `${out}/${name}-case.png`, fullPage: true })
  if (name === 'desktop') {
    await page.getByRole('tab', { name: /AI確認/ }).click()
    await page.screenshot({ path: `${out}/${name}-ai.png`, fullPage: true })
    await page.getByRole('tab', { name: 'リマインド' }).click()
    await page.screenshot({ path: `${out}/${name}-reminder.png`, fullPage: true })
    // get a portal link
    await page.getByRole('button', { name: '共有リンクを発行' }).click()
    const url = await page.getByLabel('共有リンク').inputValue()
    process.env.PORTAL = url
  }
  await ctx.close()
}
const portal = process.env.PORTAL!.replace(/^https?:\/\/[^/]+/, base)
for (const [name, dev] of profiles) {
  const ctx = await browser.newContext({ ...dev, locale: 'ja-JP' })
  const page = await ctx.newPage()
  await page.goto(portal)
  await page.getByText(/必要な情報 \d+件中/).waitFor()
  await page.screenshot({ path: `${out}/${name}-portal.png`, fullPage: name !== 'desktop' ? false : true })
  await ctx.close()
}
await browser.close()
console.log('portal', portal)
