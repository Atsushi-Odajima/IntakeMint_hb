// Creates the fictional "Sample Creative Studio" workspace (is_sample=true). Development / demo only.
import { createCtx } from '../src/server/ctx'
import { seedSample } from '../src/server/seed'
const ctx = await createCtx()
const r = await seedSample(ctx)
console.log(r.created ? `Sample workspace created.\n  login: ${r.email}\n  password: ${r.password}` : `Sample workspace already exists (${r.email}).`)
await ctx.db.close()
