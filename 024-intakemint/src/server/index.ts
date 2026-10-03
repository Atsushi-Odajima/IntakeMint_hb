// Server entry point: API + PWA static files + background worker.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCtx } from './ctx'
import { buildApp } from './app'
import { startWorker } from './jobs/worker'
import { seedSample } from './seed'

const here = path.dirname(fileURLToPath(import.meta.url))
const ctx = await createCtx()
if (process.env.SEED_SAMPLE === 'true') {
  const r = await seedSample(ctx)
  if (r.created) console.log(`[seed] Sample workspace created. login: ${r.email} / ${r.password}`)
}
const app = await buildApp(ctx, { webDist: process.env.WEB_DIST ?? path.resolve(here, '../../dist/web'), logger: process.env.LOG_REQUESTS === 'true' })
const stop = process.env.DISABLE_WORKER === 'true' ? () => {} : startWorker(ctx)
await app.listen({ port: ctx.config.port, host: process.env.HOST ?? '0.0.0.0' })
console.log(`IntakeMint listening on ${ctx.config.port} (db=${ctx.db.kind}, ai=${ctx.ai.external && ctx.config.ai.allowExternal ? ctx.ai.external.name : 'local-heuristic'}, email=${ctx.email.name})`)
const shutdown = async () => { stop(); await app.close(); await ctx.db.close(); process.exit(0) }
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown)
