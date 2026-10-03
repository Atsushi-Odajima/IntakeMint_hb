// Restore an organization backup ZIP into this (empty) environment: npm run restore -- ./backup.zip
import fs from 'node:fs'
import { createCtx } from '../src/server/ctx'
import { restoreOrg } from '../src/server/services/backup'
const file = process.argv[2]
if (!file) { console.error('usage: npm run restore -- <backup.zip>'); process.exit(1) }
const ctx = await createCtx()
const r = await restoreOrg(ctx, new Uint8Array(fs.readFileSync(file)))
console.log(JSON.stringify(r, null, 2))
if (!r.fingerprintMatch) { console.error('WARNING: relation fingerprint mismatch'); process.exitCode = 2 }
await ctx.db.close()
