import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createPgliteDb, migrate } from '../src/server/db'
import { createCtx } from '../src/server/ctx'
import { LocalStorage } from '../src/server/storage'
import { OutboxProvider } from '../src/server/email'
import { buildApp } from '../src/server/app'
import { signup } from '../src/server/services/orgs'
import { createTemplate, publishTemplate } from '../src/server/services/templates'
import type { Actor, Ctx } from '../src/server/services/context'
import type { AiProvider } from '../src/server/ai/providers'

export class Clock { t: number; constructor(iso = '2026-10-05T03:00:00Z') { this.t = Date.parse(iso) } now = () => new Date(this.t); advance(ms: number) { this.t += ms } set(iso: string) { this.t = Date.parse(iso) } }

export async function makeCtx(o: { externalAi?: AiProvider; allowExternal?: boolean; clock?: Clock } = {}) {
  const db = await createPgliteDb()
  await migrate(db)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'im-test-'))
  const clock = o.clock ?? new Clock()
  const email = new OutboxProvider()
  const ctx = await createCtx({
    db, storage: new LocalStorage(dir), email, externalAi: o.externalAi, now: clock.now,
    config: { env: 'test', signingSecret: 'test-secret-'.padEnd(40, 'x'), storageDir: dir, ai: { provider: o.externalAi ? 'anthropic' : 'local', allowExternal: !!o.allowExternal } },
  })
  return { ctx, clock, email, dir }
}

export async function makeOrg(ctx: Ctx, name = 'Org', email = `${name.toLowerCase().replace(/\W/g, '')}-${Math.random().toString(36).slice(2, 8)}@example.test`) {
  const { orgId, userId } = await signup(ctx, { orgName: name, email, name: `${name} Owner`, password: 'password-12345' })
  const owner: Actor = { type: 'user', orgId, userId, role: 'owner' }
  const ws = await ctx.db.one('SELECT id FROM workspaces WHERE org_id=$1', [orgId])
  return { orgId, userId, owner, workspaceId: ws.id as string, email }
}

export async function webTemplate(ctx: Ctx, owner: Actor, workspaceId: string) {
  const t = await createTemplate(ctx, owner, { workspaceId, name: 'Web', sampleKey: 'web' })
  const v = await publishTemplate(ctx, owner, t.id)
  return { templateId: t.id as string, versionId: v.versionId }
}

export async function app(ctx: Ctx) { return buildApp(ctx) }

/** login helper for HTTP tests: returns cookie + csrf */
export async function httpLogin(a: Awaited<ReturnType<typeof buildApp>>, email: string, password = 'password-12345') {
  const r = await a.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } })
  if (r.statusCode !== 200) throw new Error('login failed ' + r.body)
  const cookie = String(r.headers['set-cookie']).split(';')[0]
  return { cookie, csrf: r.json().csrf as string }
}

export function multipart(fields: Record<string, string>, file: { name: string; data: Buffer; type?: string }) {
  const boundary = '----imtest' + Math.random().toString(16).slice(2)
  const parts: Buffer[] = []
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`))
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type ?? 'application/octet-stream'}\r\n\r\n`), file.data, Buffer.from(`\r\n--${boundary}--\r\n`))
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } }
}
