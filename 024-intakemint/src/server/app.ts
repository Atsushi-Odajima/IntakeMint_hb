// HTTP API (Fastify). Every internal route resolves the session server-side and checks RBAC in the service layer.
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import cookie from '@fastify/cookie'
import multipart from '@fastify/multipart'
import rateLimit from '@fastify/rate-limit'
import helmet from '@fastify/helmet'
import fstatic from '@fastify/static'
import fs from 'node:fs'
import path from 'node:path'
import { z, ZodError } from 'zod'
import type { Ctx, Actor } from './services/context'
import { HttpError, forbidden, notFound } from './services/context'
import * as orgs from './services/orgs'
import * as tpl from './services/templates'
import * as cases from './services/cases'
import * as access from './services/access'
import * as intake from './services/intake'
import * as review from './services/review'
import * as rem from './services/reminders'
import * as pkgs from './services/packages'
import * as backup from './services/backup'
import { search } from './services/search'
import { runCaseAnalysis, setFileAiExcluded } from './services/ai'
import { requirePerm, permissionMatrix } from './services/rbac'
import { signObjectUrl, verifySignedUrl, safeEqual } from './security/crypto'
import { sampleTemplates } from '../shared/sampleTemplates'
import { ROLES } from '../shared/types'
import { audit } from './services/audit'

const SESSION_COOKIE = 'im_session'

declare module 'fastify' {
  interface FastifyRequest { actor?: Actor; sessionToken?: string; csrf?: string; me?: orgs.SessionInfo }
}

const parse = <T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> => schema.parse(data)

export async function buildApp(ctx: Ctx, opts: { webDist?: string; logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ? {
      serializers: { req: (r) => ({ method: r.method, url: String(r.url).replace(/\/(p|portal)\/[^/?]+/g, '/$1/[token]').replace(/([?&](s|k)=)[^&]+/g, '$1[redacted]') }) },
    } : false,
    bodyLimit: 2 * 1024 * 1024,
    trustProxy: process.env.TRUST_PROXY === 'true',
  })

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"], fontSrc: ["'self'"], objectSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'self'"], formAction: ["'self'"],
        workerSrc: ["'self'"], manifestSrc: ["'self'"], upgradeInsecureRequests: ctx.config.env === 'production' ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'no-referrer' },
    hsts: ctx.config.env === 'production',
  })
  await app.register(cookie)
  await app.register(rateLimit, { max: Number(process.env.RATE_LIMIT_MAX ?? 600), timeWindow: '1 minute' })
  await app.register(multipart, { limits: { fileSize: ctx.config.maxUploadMB * 1024 * 1024, files: 1, fields: 10 } })

  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: err.message, code: err.code, details: err.details })
    if (err instanceof ZodError) return reply.status(400).send({ error: '入力内容が正しくありません', code: 'validation', details: err.issues.slice(0, 20) })
    if (err.statusCode === 429) return reply.status(429).send({ error: 'リクエストが多すぎます。しばらく待ってから再度お試しください', code: 'rate_limited' })
    if (err.code === 'FST_REQ_FILE_TOO_LARGE') return reply.status(413).send({ error: 'ファイルサイズが上限を超えています', code: 'too_large' })
    if (err.statusCode && err.statusCode < 500) return reply.status(err.statusCode).send({ error: err.message, code: 'bad_request' })
    req.log?.error?.(err)
    if (ctx.config.env !== 'production') console.error(err)
    return reply.status(500).send({ error: 'サーバーエラーが発生しました', code: 'internal' })
  })

  // ---------- auth helpers ----------
  const ip = (req: FastifyRequest) => req.ip
  async function internal(req: FastifyRequest): Promise<Actor> {
    const auth = req.headers.authorization
    if (auth?.startsWith('Bearer imt_')) {
      const a = await orgs.resolveApiToken(ctx.db, auth.slice(7))
      if (!a) throw new HttpError(401, '認証が必要です', 'unauthenticated')
      return { ...a, ip: ip(req) }
    }
    const token = req.cookies[SESSION_COOKIE]
    const s = await orgs.resolveSession(ctx, token)
    if (!s) throw new HttpError(401, 'ログインが必要です', 'unauthenticated')
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const h = req.headers['x-csrf-token']
      if (typeof h !== 'string' || !safeEqual(h, s.csrf)) throw new HttpError(403, 'CSRFトークンが不正です', 'csrf')
    }
    req.sessionToken = token
    req.me = s
    return { type: 'user', orgId: s.orgId, userId: s.userId, role: s.role, ip: ip(req) }
  }
  async function client(req: FastifyRequest, allowUnverified = false): Promise<Actor & { session: access.ClientSession }> {
    const token = (req.params as any).token as string
    const s = await access.resolveToken(ctx, token)
    if (s.needsVerification && !allowUnverified) throw new HttpError(403, 'メールアドレスの確認が必要です', 'verification_required')
    return { type: 'client', orgId: s.orgId, caseId: s.caseId, ip: ip(req), session: s }
  }
  const P = (req: FastifyRequest) => req.params as Record<string, string>
  const uuid = z.string().uuid()

  // ---------- health ----------
  app.get('/api/health', async () => ({ ok: true, version: ctx.config.appVersion, db: ctx.db.kind }))

  // ---------- auth ----------
  const cookieOpts = { httpOnly: true, sameSite: 'lax' as const, secure: ctx.config.env === 'production', path: '/' }
  app.post('/api/auth/signup', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    if (ctx.config.env === 'production' && process.env.ALLOW_SIGNUP !== 'true') throw forbidden('新規登録は無効です')
    const b = parse(z.object({ orgName: z.string().min(1).max(100), email: z.string().email().max(200), name: z.string().min(1).max(100), password: z.string().min(10).max(200) }), req.body)
    await orgs.signup(ctx, b)
    const s = await orgs.login(ctx, b.email, b.password, ip(req))
    reply.setCookie(SESSION_COOKIE, s.token, { ...cookieOpts, expires: s.expires })
    return { csrf: s.csrf }
  })
  app.post('/api/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const b = parse(z.object({ email: z.string().max(200), password: z.string().max(200) }), req.body)
    const s = await orgs.login(ctx, b.email, b.password, ip(req))
    reply.setCookie(SESSION_COOKIE, s.token, { ...cookieOpts, expires: s.expires })
    return { csrf: s.csrf }
  })
  app.post('/api/auth/logout', async (req, reply) => {
    const t = req.cookies[SESSION_COOKIE]
    if (t) await orgs.logout(ctx, t)
    reply.clearCookie(SESSION_COOKIE, { path: '/' })
    return { ok: true }
  })
  app.get('/api/me', async (req) => {
    const a = await internal(req)
    const me = req.me
    return {
      user: me ? { id: me.userId, name: me.name, email: me.email } : { id: a.userId }, orgId: a.orgId, role: a.role, csrf: me?.csrf,
      orgs: a.userId ? await orgs.listMyOrgs(ctx, a.userId) : [], settings: await cases.orgSettings(ctx.db, a.orgId), permissions: permissionMatrix[a.role!],
    }
  })
  app.post('/api/me/org', async (req) => {
    const a = await internal(req)
    const b = parse(z.object({ orgId: uuid }), req.body)
    await orgs.switchOrg(ctx, req.sessionToken!, a.userId!, b.orgId)
    return { ok: true }
  })

  // ---------- organization ----------
  app.get('/api/org/settings', async (req) => { const a = await internal(req); requirePerm(a, 'read'); return cases.orgSettings(ctx.db, a.orgId) })
  app.patch('/api/org/settings', async (req) => {
    const a = await internal(req)
    const b = parse(z.object({
      aiEnabled: z.boolean().optional(), timezone: z.string().max(60).optional(), retentionDays: z.number().int().min(30).max(3650).optional(),
      allowUrlTitleFetch: z.boolean().optional(),
      branding: z.object({ color: z.string().optional(), senderName: z.string().min(1).max(80).optional(), logoDataUrl: z.string().max(300000).optional(), intro: z.string().max(2000).optional(), completionMessage: z.string().max(2000).optional() }).optional(),
    }), req.body)
    return orgs.updateSettings(ctx, a, b as any)
  })
  app.get('/api/org/members', async (req) => orgs.listMembers(ctx, await internal(req)))
  app.post('/api/org/members', async (req) => {
    const a = await internal(req)
    const b = parse(z.object({ email: z.string().email(), name: z.string().min(1).max(100), role: z.enum(ROLES), password: z.string().min(10).max(200).optional() }), req.body)
    return { id: await orgs.addMember(ctx, a, b) }
  })
  app.patch('/api/org/members/:id', async (req) => {
    const a = await internal(req)
    await orgs.changeRole(ctx, a, parse(uuid, P(req).id), parse(z.object({ role: z.enum(ROLES) }), req.body).role)
    return { ok: true }
  })
  app.delete('/api/org/members/:id', async (req) => { await orgs.removeMember(ctx, await internal(req), parse(uuid, P(req).id)); return { ok: true } })
  app.get('/api/org/workspaces', async (req) => { const a = await internal(req); requirePerm(a, 'read'); return (await ctx.db.query('SELECT id, name FROM workspaces WHERE org_id=$1 ORDER BY created_at', [a.orgId])).rows })
  app.post('/api/org/workspaces', async (req) => {
    const a = await internal(req); requirePerm(a, 'org.manage')
    const b = parse(z.object({ name: z.string().min(1).max(100) }), req.body)
    const r = await ctx.db.one('INSERT INTO workspaces (org_id, name) VALUES ($1,$2) RETURNING id', [a.orgId, b.name])
    await audit(ctx.db, a, 'workspace.create', 'workspace', r.id, {})
    return r
  })
  app.get('/api/org/audit', async (req) => {
    const a = await internal(req); requirePerm(a, 'audit.read')
    const q = parse(z.object({ limit: z.coerce.number().int().min(1).max(500).default(100), action: z.string().max(60).optional() }), req.query)
    return (await ctx.db.query(`SELECT * FROM audit_logs WHERE org_id=$1 AND ($2::text IS NULL OR action LIKE $2 || '%') ORDER BY id DESC LIMIT $3`, [a.orgId, q.action ?? null, q.limit])).rows
  })
  app.get('/api/org/notifications', async (req) => {
    const a = await internal(req); requirePerm(a, 'read')
    return (await ctx.db.query('SELECT * FROM notifications WHERE org_id=$1 ORDER BY updated_at DESC LIMIT 50', [a.orgId])).rows
  })
  app.post('/api/org/notifications/read', async (req) => {
    const a = await internal(req); requirePerm(a, 'read')
    await ctx.db.query('UPDATE notifications SET read_at=now() WHERE org_id=$1 AND read_at IS NULL', [a.orgId])
    return { ok: true }
  })
  app.get('/api/org/outbox', async (req) => {
    const a = await internal(req); requirePerm(a, 'reminder.send')
    return (await ctx.db.query('SELECT id, case_id, to_address, subject, status, attempts, last_error, provider, created_at, sent_at FROM email_outbox WHERE org_id=$1 ORDER BY created_at DESC LIMIT 100', [a.orgId])).rows
  })
  app.get('/api/org/tokens', async (req) => {
    const a = await internal(req); requirePerm(a, 'token.manage')
    return (await ctx.db.query('SELECT id, name, created_at, revoked_at, last_used_at FROM api_tokens WHERE org_id=$1 ORDER BY created_at DESC', [a.orgId])).rows
  })
  app.post('/api/org/tokens', async (req) => orgs.createApiToken(ctx, await internal(req), parse(z.object({ name: z.string().min(1).max(80) }), req.body).name))
  app.delete('/api/org/tokens/:id', async (req) => { await orgs.revokeApiToken(ctx, await internal(req), parse(uuid, P(req).id)); return { ok: true } })
  app.get('/api/org/export', async (req, reply) => {
    const a = await internal(req)
    const { zip } = await backup.exportOrg(ctx, a)
    reply.header('content-type', 'application/zip').header('content-disposition', `attachment; filename="intakemint-backup-${ctx.now().toISOString().slice(0, 10)}.zip"`)
    return reply.send(Buffer.from(zip))
  })
  app.get('/api/org/ai-usage', async (req) => {
    const a = await internal(req); requirePerm(a, 'read')
    return (await ctx.db.query(`SELECT provider, external, purpose, count(*)::int AS calls, sum(input_chars)::int AS chars FROM ai_calls WHERE org_id=$1 GROUP BY provider, external, purpose`, [a.orgId])).rows
  })

  // ---------- templates ----------
  app.get('/api/templates/samples', async () => sampleTemplates.map((s) => ({ key: s.key, name: s.name, description: s.description, industry: s.industry })))
  app.get('/api/templates', async (req) => tpl.listTemplates(ctx, await internal(req)))
  app.post('/api/templates', async (req) => {
    const a = await internal(req)
    const b = parse(z.object({ workspaceId: uuid.optional(), name: z.string().min(1).max(200), description: z.string().max(2000).optional(), industry: z.string().max(50).optional(), sampleKey: z.string().max(40).optional(), definition: z.unknown().optional() }), req.body)
    const ws = b.workspaceId ?? (await ctx.db.one('SELECT id FROM workspaces WHERE org_id=$1 ORDER BY created_at LIMIT 1', [a.orgId]))?.id
    return tpl.createTemplate(ctx, a, { ...b, workspaceId: ws })
  })
  app.post('/api/templates/lint', async (req) => { await internal(req); return tpl.lintDefinition(tpl.parseDefinition((req.body as any)?.definition)) })
  app.get('/api/templates/:id', async (req) => tpl.getTemplate(ctx, await internal(req), parse(uuid, P(req).id)))
  app.put('/api/templates/:id', async (req) => {
    const b = parse(z.object({ name: z.string().min(1).max(200).optional(), description: z.string().max(2000).optional(), definition: z.unknown().optional() }), req.body)
    return tpl.updateDraft(ctx, await internal(req), parse(uuid, P(req).id), b)
  })
  app.post('/api/templates/:id/publish', async (req) => tpl.publishTemplate(ctx, await internal(req), parse(uuid, P(req).id)))
  app.post('/api/templates/:id/archive', async (req) => { await tpl.archiveTemplate(ctx, await internal(req), parse(uuid, P(req).id)); return { ok: true } })

  // ---------- cases ----------
  app.get('/api/dashboard', async (req) => cases.dashboard(ctx, await internal(req)))
  app.get('/api/cases', async (req) => {
    const q = parse(z.object({ status: z.string().max(40).optional(), q: z.string().max(100).optional(), limit: z.coerce.number().optional(), offset: z.coerce.number().optional() }), req.query)
    return cases.listCases(ctx, await internal(req), q)
  })
  app.post('/api/cases', async (req) => {
    const b = parse(z.object({ templateId: uuid, clientName: z.string().min(1).max(200), clientEmail: z.string().email().max(200).optional().or(z.literal('').transform(() => undefined)), projectName: z.string().min(1).max(200), targetReadyDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), tags: z.array(z.string().max(40)).max(20).optional() }), req.body)
    return { id: await cases.createCase(ctx, await internal(req), b) }
  })
  app.get('/api/cases/:id', async (req) => cases.caseDetail(ctx, await internal(req), parse(uuid, P(req).id)))
  app.patch('/api/cases/:id', async (req) => {
    const b = parse(z.object({ clientName: z.string().min(1).max(200).optional(), clientEmail: z.string().email().nullable().optional(), projectName: z.string().min(1).max(200).optional(), targetReadyDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), tags: z.array(z.string().max(40)).max(20).optional(), aiEnabled: z.boolean().optional(), status: z.enum(['archived', 'cancelled']).optional() }), req.body)
    await cases.updateCase(ctx, await internal(req), parse(uuid, P(req).id), b)
    return { ok: true }
  })
  app.delete('/api/cases/:id', async (req) => { await cases.deleteCase(ctx, await internal(req), parse(uuid, P(req).id)); return { ok: true } })
  app.post('/api/cases/:id/answers', async (req) => intake.saveAnswers(ctx, await internal(req), parse(uuid, P(req).id), parse(z.object({ answers: z.record(z.string(), z.unknown()) }), req.body).answers))
  app.post('/api/cases/:id/files', async (req) => {
    const a = await internal(req)
    const { itemId, filename, buf, aiExcluded } = await readUpload(req)
    return intake.uploadFile(ctx, a, parse(uuid, P(req).id), itemId, filename, buf, { aiExcluded })
  })
  app.post('/api/cases/:id/links', async (req) => {
    const b = parse(z.object({ days: z.number().int().min(1).max(90).optional(), requireEmailVerification: z.boolean().optional(), revokeExisting: z.boolean().optional() }), req.body ?? {})
    return access.issueLink(ctx, await internal(req), parse(uuid, P(req).id), b)
  })
  app.delete('/api/cases/:id/links/:linkId', async (req) => { await access.revokeLink(ctx, await internal(req), parse(uuid, P(req).id), parse(uuid, P(req).linkId)); return { ok: true } })
  app.post('/api/cases/:id/items/:itemId/review', async (req) => {
    const b = parse(z.object({ decision: z.enum(['accept', 'reject', 'needs_review', 'not_applicable', 'reopen']), note: z.string().max(2000).optional() }), req.body)
    return review.reviewItem(ctx, await internal(req), parse(uuid, P(req).id), parse(z.string().max(80), P(req).itemId), b.decision, b.note)
  })
  app.post('/api/files/:id/review', async (req) => {
    const b = parse(z.object({ decision: z.enum(['accept', 'reject']), note: z.string().max(2000).optional() }), req.body)
    return review.reviewFile(ctx, await internal(req), parse(uuid, P(req).id), b.decision, b.note)
  })
  app.post('/api/files/:id/ai-exclusion', async (req) => {
    const a = await internal(req); requirePerm(a, 'case.edit')
    const f = await setFileAiExcluded(ctx, a, parse(uuid, P(req).id), parse(z.object({ excluded: z.boolean() }), req.body).excluded)
    if (!f) throw notFound('ファイル')
    return { ok: true }
  })
  app.get('/api/files/:id/url', async (req) => {
    const a = await internal(req); requirePerm(a, 'read')
    const f = await ctx.db.one('SELECT storage_key, mime FROM files WHERE id=$1 AND org_id=$2', [parse(uuid, P(req).id), a.orgId])
    if (!f) throw notFound('ファイル')
    const inline = (req.query as any).inline === '1' && /^image\/(png|jpeg|gif|webp)$|^application\/pdf$/.test(f.mime)
    await audit(ctx.db, a, 'file.download_url', 'file', P(req).id, {})
    return { url: signObjectUrl(ctx.config.signingSecret, f.storage_key, ctx.config.signedUrlTtlSeconds, ctx.now().getTime(), inline ? 'inline' : 'attachment'), expiresIn: ctx.config.signedUrlTtlSeconds }
  })
  app.get('/api/files/signed', async (req, reply) => {
    const q = parse(z.object({ k: z.string().max(300), e: z.coerce.number(), d: z.enum(['inline', 'attachment']), s: z.string().max(100) }), req.query)
    const v = verifySignedUrl(ctx.config.signingSecret, q.k, q.e, q.d, q.s, ctx.now().getTime())
    if (v !== 'ok') throw new HttpError(403, v === 'expired' ? 'URLの有効期限が切れています' : 'URLが不正です', `signed_${v}`)
    const f = await ctx.db.one('SELECT original_name, mime FROM files WHERE storage_key=$1', [q.k])
    const buf = f ? await ctx.storage.get(q.k) : null
    if (!f || !buf) throw notFound('ファイル')
    reply.header('content-type', f.mime === 'image/svg+xml' ? 'application/octet-stream' : f.mime)
      .header('content-disposition', `${q.d}; filename*=UTF-8''${encodeURIComponent(f.original_name)}`)
      .header('x-content-type-options', 'nosniff').header('content-security-policy', "default-src 'none'; sandbox").header('cache-control', 'private, no-store')
    return reply.send(buf)
  })
  app.post('/api/cases/:id/ai/run', async (req) => {
    const a = await internal(req); requirePerm(a, 'ai.run')
    const id = parse(uuid, P(req).id)
    await cases.loadState(ctx.db, a.orgId, id)
    const r = await runCaseAnalysis(ctx, a.orgId, id, a)
    await cases.recompute(ctx, ctx.db, a.orgId, id, a)
    return r
  })
  app.post('/api/candidates/:id/resolve', async (req) => {
    const b = parse(z.object({ decision: z.enum(['send_to_client', 'dismiss', 'resolve']), text: z.string().max(2000).optional(), note: z.string().max(2000).optional() }), req.body)
    return review.resolveCandidate(ctx, await internal(req), parse(uuid, P(req).id), b.decision, b)
  })
  app.post('/api/cases/:id/followups', async (req) => {
    const b = parse(z.object({ text: z.string().min(1).max(2000), questionId: z.string().max(64).optional() }), req.body)
    return { id: await review.requestMoreInfo(ctx, await internal(req), parse(uuid, P(req).id), b.text, b.questionId) }
  })
  app.post('/api/followups/:id/resolve', async (req) => {
    const b = parse(z.object({ decision: z.enum(['resolve', 'reopen', 'cancel']), applyToQuestion: z.boolean().optional(), note: z.string().max(2000).optional() }), req.body)
    return review.resolveFollowup(ctx, await internal(req), parse(uuid, P(req).id), b.decision, b)
  })
  app.post('/api/cases/:id/signoff', async (req) => {
    const st = await review.signoff(ctx, await internal(req), parse(uuid, P(req).id), parse(z.object({ note: z.string().max(2000).optional() }), req.body ?? {}).note)
    return { status: st.row.status, ready: st.result.ready }
  })
  app.post('/api/cases/:id/override', async (req) => {
    const st = await review.overrideReady(ctx, await internal(req), parse(uuid, P(req).id), parse(z.object({ reason: z.string().max(1000) }), req.body).reason)
    return { status: st.row.status }
  })
  app.post('/api/cases/:id/start', async (req) => { await cases.markStarted(ctx, await internal(req), parse(uuid, P(req).id)); return { ok: true } })
  app.post('/api/cases/:id/reminders', async (req) => ({ id: await rem.draftManualReminder(ctx, await internal(req), parse(uuid, P(req).id)) }))
  app.post('/api/reminders/:id/approve', async (req) => {
    const b = parse(z.object({ subject: z.string().max(300).optional(), body: z.string().max(8000).optional(), includeNewLink: z.boolean().optional() }), req.body ?? {})
    await rem.approveReminder(ctx, await internal(req), parse(uuid, P(req).id), b)
    return { ok: true }
  })
  app.post('/api/reminders/:id/cancel', async (req) => { await rem.cancelReminder(ctx, await internal(req), parse(uuid, P(req).id)); return { ok: true } })
  app.post('/api/cases/:id/packages', async (req) => {
    const b = parse(z.object({ profile: z.enum(['web_development', 'design', 'video', 'sns_management', 'consulting', 'recruiting', 'accounting_prep', 'generic']).optional() }), req.body ?? {})
    const r = await pkgs.generatePackage(ctx, await internal(req), parse(uuid, P(req).id), b.profile)
    return { id: r.id, version: r.version, package: r.package, markdown: r.markdown }
  })
  app.get('/api/packages/:id', async (req, reply) => {
    const a = await internal(req)
    const p = await pkgs.getPackage(ctx, a, parse(uuid, P(req).id))
    const fmt = (req.query as any).format ?? 'json'
    if (fmt === 'md' || fmt === 'txt') {
      await audit(ctx.db, a, 'package.export', 'case', p.case_id, { packageId: p.id, format: fmt })
      reply.header('content-type', `${fmt === 'md' ? 'text/markdown' : 'text/plain'}; charset=utf-8`).header('content-disposition', `attachment; filename="intake-package-v${p.version}.${fmt}"`)
      return reply.send(fmt === 'md' ? p.markdown : pkgs.toText(p.markdown))
    }
    return p
  })
  app.get('/api/cases/:id/export.csv', async (req, reply) => {
    const csv = await backup.exportCaseCsv(ctx, await internal(req), parse(uuid, P(req).id))
    reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="case-responses.csv"')
    return reply.send(csv)
  })
  app.get('/api/search', async (req) => {
    const q = parse(z.object({ q: z.string().max(100), type: z.string().max(20).optional() }), req.query)
    return search(ctx, await internal(req), q.q, { type: q.type })
  })

  // ---------- client portal (no account; token-scoped to one case) ----------
  const portalLimit = { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }
  app.get('/api/portal/:token', portalLimit, async (req) => {
    const c = await client(req, true)
    const settings = await cases.orgSettings(ctx.db, c.orgId)
    const branding = { senderName: settings.branding.senderName, color: settings.branding.color, logoDataUrl: settings.branding.logoDataUrl, intro: settings.branding.intro, completionMessage: settings.branding.completionMessage }
    if (c.session.needsVerification) return { needsVerification: true, branding }
    return portalView(c.orgId, c.caseId!, branding)
  })
  app.post('/api/portal/:token/answers', portalLimit, async (req) => {
    const c = await client(req)
    const r = await intake.saveAnswers(ctx, c, c.caseId as string, parse(z.object({ answers: z.record(z.string(), z.unknown()) }), req.body).answers)
    return { saved: r.saved, errors: r.errors, progress: r.completeness.progress }
  })
  app.post('/api/portal/:token/files', portalLimit, async (req) => {
    const c = await client(req)
    const { itemId, filename, buf, aiExcluded } = await readUpload(req)
    const r = await intake.uploadFile(ctx, c, c.caseId!, itemId, filename, buf, { aiExcluded })
    return { fileId: r.fileId, status: r.status, progress: r.completeness.progress }
  })
  app.delete('/api/portal/:token/files/:fileId', portalLimit, async (req) => {
    const c = await client(req)
    await intake.deleteOwnUpload(ctx, c, parse(uuid, P(req).fileId))
    return { ok: true }
  })
  app.post('/api/portal/:token/files/:fileId/ai-exclusion', portalLimit, async (req) => {
    const c = await client(req)
    const f = await setFileAiExcluded(ctx, c, parse(uuid, P(req).fileId), parse(z.object({ excluded: z.boolean() }), req.body).excluded)
    if (!f) throw notFound('ファイル')
    return { ok: true }
  })
  app.post('/api/portal/:token/submit', portalLimit, async (req) => {
    const c = await client(req)
    const r = await intake.clientSubmit(ctx, c, c.caseId!)
    return { complete: r.complete, progress: r.completeness.progress }
  })
  app.post('/api/portal/:token/followups/:id', portalLimit, async (req) => {
    const c = await client(req)
    const r = await intake.answerFollowup(ctx, c, c.caseId!, parse(uuid, P(req).id), parse(z.object({ answer: z.unknown() }), req.body).answer)
    return { progress: r.progress }
  })
  app.post('/api/portal/:token/verify/start', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (req) => {
    const c = await client(req, true)
    const row = await ctx.db.one('SELECT client_email, project_name FROM cases WHERE id=$1', [c.caseId])
    const code = await access.startEmailVerification(ctx, c.session)
    const s = await cases.orgSettings(ctx.db, c.orgId)
    await rem.queueEmail(ctx.db, { orgId: c.orgId, caseId: c.caseId, to: row.client_email, fromName: s.branding.senderName, subject: `確認コード：${row.project_name}`, body: `確認コード：${code}\n（10分以内に入力してください）` })
    return { sentTo: String(row.client_email).replace(/(.{2}).*@/, '$1***@') }
  })
  app.post('/api/portal/:token/verify', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req) => {
    const c = await client(req, true)
    const ok = await access.verifyEmailCode(ctx, c.session, parse(z.object({ code: z.string().regex(/^\d{6}$/) }), req.body).code)
    if (!ok) throw new HttpError(400, '確認コードが正しくありません', 'bad_code')
    return { ok: true }
  })
  app.get('/api/portal/:token/files/:fileId/url', portalLimit, async (req) => {
    const c = await client(req)
    const f = await ctx.db.one('SELECT storage_key FROM files WHERE id=$1 AND case_id=$2', [parse(uuid, P(req).fileId), c.caseId])
    if (!f) throw notFound('ファイル')
    return { url: signObjectUrl(ctx.config.signingSecret, f.storage_key, 120, ctx.now().getTime()) }
  })

  async function portalView(orgId: string, caseId: string, branding: unknown) {
    const st = await cases.loadState(ctx.db, orgId, caseId)
    const vis = st.result.logic.visible
    const followups = (await ctx.db.query(`SELECT id, text, options, status, answer FROM followups WHERE case_id=$1 AND status IN ('open','answered') ORDER BY created_at`, [caseId])).rows
    const def = st.def
    return {
      case: { projectName: st.row.project_name, clientName: st.row.client_name, targetReadyDate: st.row.target_ready_date, status: st.row.status, submittedAt: st.row.client_submitted_at },
      branding,
      intro: def.intro, completionMessage: def.completionMessage,
      // Full definition is sent so the portal can evaluate conditional logic live; the server re-validates everything.
      definition: { sections: def.sections, questions: def.questions, rules: def.rules.filter((r) => (r.status ?? 'active') === 'active'), requiredItems: def.requiredItems.map((i) => ({ ...i, notes: i.notes })), completionRules: def.completionRules, reminderPolicy: def.reminderPolicy, packageTemplate: { profile: def.packageTemplate.profile, mapping: {} } },
      // hidden answers are retained (restored if the question becomes visible again) but excluded from progress
      answers: st.answers,
      items: st.result.items.map((i) => ({ itemId: i.itemId, label: i.label, type: i.type, required: i.required, applicable: i.applicable, status: i.status, count: i.count, minCount: i.minCount, answered: i.answered, total: i.total, note: i.status === 'rejected' ? i.note : null })),
      progress: st.result.progress,
      files: st.files.map((f) => ({ id: f.id, itemId: f.itemId, name: f.originalName, size: f.size, status: f.status, aiExcluded: f.ai_excluded, note: f.status === 'rejected' ? f.review_note : null, createdAt: f.created_at })),
      followups,
    }
  }

  async function readUpload(req: FastifyRequest): Promise<{ itemId: string; filename: string; buf: Buffer; aiExcluded: boolean }> {
    if (!req.isMultipart()) throw new HttpError(400, 'multipart/form-data で送信してください')
    const fields: Record<string, string> = {}
    let file: { filename: string; buf: Buffer } | null = null
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        const buf = await part.toBuffer()
        if ((part.file as any).truncated) throw new HttpError(413, 'ファイルサイズが上限を超えています', 'too_large')
        file = { filename: part.filename, buf }
      } else fields[part.fieldname] = String(part.value).slice(0, 200)
    }
    if (!file) throw new HttpError(400, 'ファイルがありません')
    if (!fields.itemId) throw new HttpError(400, '提出先の項目（itemId）がありません')
    return { itemId: fields.itemId, filename: file.filename, buf: file.buf, aiExcluded: fields.aiExcluded === 'true' }
  }

  // ---------- static web app (PWA) ----------
  const dist = opts.webDist
  if (dist && fs.existsSync(dist)) {
    await app.register(fstatic, {
      root: path.resolve(dist), prefix: '/', wildcard: false, index: false,
      setHeaders: (res, p) => {
        if (p.endsWith('sw.js')) res.header('cache-control', 'no-cache')
        else if (p.includes('/assets/')) res.header('cache-control', 'public, max-age=31536000, immutable')
      },
    })
    const index = fs.readFileSync(path.join(dist, 'index.html'), 'utf8')
    app.setNotFoundHandler((req, reply: FastifyReply) => {
      if (req.url.startsWith('/api/')) return reply.status(404).send({ error: 'Not found', code: 'not_found' })
      const clean = req.url.split('?')[0]
      const file = path.join(path.resolve(dist), path.normalize(clean))
      if (file.startsWith(path.resolve(dist)) && fs.existsSync(file) && fs.statSync(file).isFile()) return reply.sendFile(path.relative(path.resolve(dist), file))
      return reply.header('content-type', 'text/html; charset=utf-8').header('cache-control', 'no-cache').send(index)
    })
  }
  return app
}
