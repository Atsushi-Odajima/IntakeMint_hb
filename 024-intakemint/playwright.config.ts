import { defineConfig, devices } from '@playwright/test'
const PORT = 8799
export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${PORT}`, locale: 'ja-JP', launchOptions: { executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium' } },
  webServer: {
    command: `rm -rf ./data/e2e && npm run build && PGLITE_DIR=./data/e2e/pg STORAGE_DIR=./data/e2e/objects PORT=${PORT} SEED_SAMPLE=true RATE_LIMIT_MAX=5000 LOGIN_RATE_MAX=500 npx tsx src/server/index.ts`,
    url: `http://localhost:${PORT}/api/health`, timeout: 180_000, reuseExistingServer: false,
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1360, height: 900 } } },
    { name: 'iphone', use: { ...devices['iPhone 13'], browserName: 'chromium' } },
    { name: 'android', use: { ...devices['Pixel 7'] } },
    { name: 'ipad', use: { ...devices['iPad (gen 7)'], browserName: 'chromium' } },
  ],
})
