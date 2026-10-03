// Renders PWA PNG icons from the SVG sources using the pre-installed Chromium (no binary icon files hand-made).
import { chromium } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const pub = path.resolve('src/web/public')
const out = path.join(pub, 'icons')
fs.mkdirSync(out, { recursive: true })
const targets: [string, string, number][] = [
  ['icon.svg', 'icon-192.png', 192], ['icon.svg', 'icon-512.png', 512], ['icon-maskable.svg', 'icon-maskable-512.png', 512],
  ['icon-maskable.svg', 'apple-touch-icon.png', 180], ['icon.svg', 'favicon-32.png', 32], ['icon.svg', 'icon-48.png', 48],
]
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium' })
const page = await browser.newPage()
for (const [src, name, size] of targets) {
  const svg = fs.readFileSync(path.join(pub, src), 'utf8')
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`)
  await page.screenshot({ path: path.join(out, name), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } })
  console.log('wrote', name)
}
await browser.close()
