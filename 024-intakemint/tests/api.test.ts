// HTTP-level security tests: #1 tenant isolation, #2 expired/revoked token, #3 account-less client flow,
// #21 client token scoped to one case, #22 search tenant filter, #30 audit log, CSRF, RBAC, signed URL route.
import { describe, it, expect, beforeAll } from 'vitest'
import { makeCtx, makeOrg, webTemplate, app as mkApp, httpLogin, multipart } from './helpers'
import { createCase } from '../src/server/services/cases'
import { issueLink, revokeLink } from '../src/server/services/access'
import { addMember } from '../src/server/services/orgs'
import { makePng } from '../src/server/seed'

let env: Awaited<ReturnType<typeof makeCtx>>
let a: Awaited<ReturnType<typeof mkApp>>
let A: Awaited<ReturnType<typeof makeOrg>>, B: Awaited<ReturnType<typeof makeOrg>>
let caseA: string, caseA2: string, caseB: string, tA: { templateId: string }

beforeAll(async () => {
  env = await makeCtx()
  a = await mkApp(env.ctx)
  A = await makeOrg(env.ctx, 'TenantA'); B = await makeOrg(env.ctx, 'TenantB')
  tA = await webTemplate(env.ctx, A.owner, A.workspaceId)
  const tB = await webTemplate(env.ctx, B.owner, B.workspaceId)
  caseA = await createCase(env.ctx, A.owner, { templateId: tA.templateId, clientName: 'Aクライアント', clientEmail: 'ca@example.test', projectName: 'A案件ユニーク語', targetReadyDate: '2026-10-20' })
  caseA2 = await createCase(env.ctx, A.owner, { templateId: tA.templateId, clientName: 'A2', projectName: 'A2案件' })
  caseB = await createCase(env.ctx, B.owner, { templateId: tB.templateId, clientName: 'Bクライアント', projectName: 'B案件ひみつ語' })
})

describe('#1 tenant A cannot access tenant B', () => {
  it('case / file / response / package of B => 404 for A', async () => {
    const s = await httpLogin(a, A.email)
    const h = { cookie: s.cookie, 'x-csrf-token': s.csrf }
    expect((await a.inject({ method: 'GET', url: `/api/cases/${caseB}`, headers: h })).statusCode).toBe(404)
    expect((await a.inject({ method: 'POST', url: `/api/cases/${caseB}/answers`, headers: h, payload: { answers: { company_name: 'x' } } })).statusCode).toBe(404)
    expect((await a.inject({ method: 'POST', url: `/api/cases/${caseB}/links`, headers: h, payload: {} })).statusCode).toBe(404)
    expect((await a.inject({ method: 'POST', url: `/api/cases/${caseB}/packages`, headers: h, payload: {} })).statusCode).toBe(404)
    // B uploads a file; A cannot get its URL nor review it
    const linkB = await issueLink(env.ctx, B.owner, caseB)
    const up = multipart({ itemId: 'product_images' }, { name: 'p.png', data: makePng(1, 2, 3) })
    const r = await a.inject({ method: 'POST', url: `/api/portal/${linkB.token}/files`, ...up })
    expect(r.statusCode).toBe(200)
    const fileB = r.json().fileId
    expect((await a.inject({ method: 'GET', url: `/api/files/${fileB}/url`, headers: h })).statusCode).toBe(404)
    expect((await a.inject({ method: 'POST', url: `/api/files/${fileB}/review`, headers: h, payload: { decision: 'accept' } })).statusCode).toBe(404)
    const list = (await a.inject({ method: 'GET', url: '/api/cases', headers: h })).json()
    expect(list.map((c: any) => c.id)).not.toContain(caseB)
  })
})

describe('CSRF & auth', () => {
  it('state-changing request without CSRF token is rejected; unauthenticated => 401', async () => {
    const s = await httpLogin(a, A.email)
    expect((await a.inject({ method: 'POST', url: `/api/cases/${caseA}/links`, headers: { cookie: s.cookie }, payload: {} })).statusCode).toBe(403)
    expect((await a.inject({ method: 'GET', url: `/api/cases/${caseA}` })).statusCode).toBe(401)
    expect((await a.inject({ method: 'POST', url: '/api/auth/login', payload: { email: A.email, password: 'wrong-password' } })).statusCode).toBe(401)
  })
  it('security headers: CSP, frame-ancestors none, no-referrer', async () => {
    const r = await a.inject({ method: 'GET', url: '/api/health' })
    expect(String(r.headers['content-security-policy'])).toContain("frame-ancestors 'none'")
    expect(r.headers['referrer-policy']).toBe('no-referrer')
    expect(r.headers['x-content-type-options']).toBe('nosniff')
  })
})

describe('RBAC', () => {
  it('viewer can read but not edit / publish / override', async () => {
    await addMember(env.ctx, A.owner, { email: 'viewer@a.test', name: 'V', role: 'viewer', password: 'password-12345' })
    const s = await httpLogin(a, 'viewer@a.test')
    const h = { cookie: s.cookie, 'x-csrf-token': s.csrf }
    expect((await a.inject({ method: 'GET', url: `/api/cases/${caseA}`, headers: h })).statusCode).toBe(200)
    expect((await a.inject({ method: 'POST', url: `/api/cases/${caseA}/answers`, headers: h, payload: { answers: { company_name: 'x' } } })).statusCode).toBe(403)
    expect((await a.inject({ method: 'POST', url: `/api/templates/${tA.templateId}/publish`, headers: h })).statusCode).toBe(403)
    expect((await a.inject({ method: 'POST', url: `/api/cases/${caseA}/override`, headers: h, payload: { reason: '急ぎのため' } })).statusCode).toBe(403)
    expect((await a.inject({ method: 'GET', url: '/api/org/export', headers: h })).statusCode).toBe(403)
  })
  it('editor cannot override Ready nor manage members', async () => {
    await addMember(env.ctx, A.owner, { email: 'editor@a.test', name: 'E', role: 'editor', password: 'password-12345' })
    const s = await httpLogin(a, 'editor@a.test')
    const h = { cookie: s.cookie, 'x-csrf-token': s.csrf }
    expect((await a.inject({ method: 'POST', url: `/api/cases/${caseA}/override`, headers: h, payload: { reason: '急ぎのため' } })).statusCode).toBe(403)
    expect((await a.inject({ method: 'POST', url: '/api/org/members', headers: h, payload: { email: 'x@a.test', name: 'x', role: 'admin', password: 'password-12345' } })).statusCode).toBe(403)
  })
})

describe('#2 expired / revoked client token', () => {
  it('rejects expired and revoked tokens, unknown tokens', async () => {
    const l = await issueLink(env.ctx, A.owner, caseA, { days: 1 })
    expect((await a.inject({ method: 'GET', url: `/api/portal/${l.token}` })).statusCode).toBe(200)
    env.clock.advance(2 * 86400_000)
    const exp = await a.inject({ method: 'GET', url: `/api/portal/${l.token}` })
    expect(exp.statusCode).toBe(410); expect(exp.json().code).toBe('link_expired')
    env.clock.advance(-2 * 86400_000)
    const l2 = await issueLink(env.ctx, A.owner, caseA, { days: 7 })
    await revokeLink(env.ctx, A.owner, caseA, l2.linkId)
    const rv = await a.inject({ method: 'POST', url: `/api/portal/${l2.token}/answers`, payload: { answers: { company_name: 'x' } } })
    expect(rv.statusCode).toBe(410); expect(rv.json().code).toBe('link_revoked')
    expect((await a.inject({ method: 'GET', url: `/api/portal/${'x'.repeat(43)}` })).statusCode).toBe(401)
  })
  it('reissue revokes previous links', async () => {
    const l1 = await issueLink(env.ctx, A.owner, caseA2)
    const l2 = await issueLink(env.ctx, A.owner, caseA2, { revokeExisting: true })
    expect((await a.inject({ method: 'GET', url: `/api/portal/${l1.token}` })).statusCode).toBe(410)
    expect((await a.inject({ method: 'GET', url: `/api/portal/${l2.token}` })).statusCode).toBe(200)
  })
})

describe('#3 account-less client flow & #21 token scope', () => {
  it('client answers, uploads, saves and resumes, submits — without an account', async () => {
    const l = await issueLink(env.ctx, A.owner, caseA)
    const v = (await a.inject({ method: 'GET', url: `/api/portal/${l.token}` })).json()
    expect(v.case.projectName).toBe('A案件ユニーク語')
    expect(v.progress.denominator).toBe(7)
    const s1 = await a.inject({ method: 'POST', url: `/api/portal/${l.token}/answers`, payload: { answers: { company_name: '株式会社A', company_address: '東京', contact_email: 'not-an-email' } } })
    expect(s1.statusCode).toBe(200)
    expect(s1.json().saved).toEqual(['company_name', 'company_address'])
    expect(s1.json().errors[0].questionId).toBe('contact_email')
    // resume later: answers are persisted server-side
    const v2 = (await a.inject({ method: 'GET', url: `/api/portal/${l.token}` })).json()
    expect(v2.answers.company_name).toBe('株式会社A')
    expect(v2.items.find((i: any) => i.itemId === 'company_info').status).toBe('accepted')
    const up = multipart({ itemId: 'logo' }, { name: 'logo.png', data: makePng(9, 9, 9) })
    expect((await a.inject({ method: 'POST', url: `/api/portal/${l.token}/files`, ...up })).statusCode).toBe(200)
    const sub = await a.inject({ method: 'POST', url: `/api/portal/${l.token}/submit` })
    expect(sub.statusCode).toBe(200); expect(sub.json().complete).toBe(false)
    // portal never exposes internal-only data
    expect(JSON.stringify(v2)).not.toContain('ai_candidates')
  })
  it('#21 client token cannot touch another case', async () => {
    const l = await issueLink(env.ctx, A.owner, caseA)
    const other = await a.inject({ method: 'GET', url: `/api/cases/${caseA2}`, headers: { authorization: `Bearer ${l.token}` } })
    expect(other.statusCode).toBe(401)
    // file of another case via portal url route
    const l2 = await issueLink(env.ctx, A.owner, caseA2)
    const up = multipart({ itemId: 'logo' }, { name: 'l.png', data: makePng(1, 1, 1) })
    const fid = (await a.inject({ method: 'POST', url: `/api/portal/${l2.token}/files`, ...up })).json().fileId
    expect((await a.inject({ method: 'GET', url: `/api/portal/${l.token}/files/${fid}/url` })).statusCode).toBe(404)
    expect((await a.inject({ method: 'DELETE', url: `/api/portal/${l.token}/files/${fid}` })).statusCode).toBe(404)
    expect((await a.inject({ method: 'POST', url: `/api/portal/${l.token}/files/${fid}/ai-exclusion`, payload: { excluded: true } })).statusCode).toBe(404)
  })
  it('#10 (HTTP) invalid MIME / extension is rejected at upload', async () => {
    const l = await issueLink(env.ctx, A.owner, caseA)
    const bad = multipart({ itemId: 'product_images' }, { name: 'virus.png', data: Buffer.from('MZ this is not a png') })
    const r = await a.inject({ method: 'POST', url: `/api/portal/${l.token}/files`, ...bad })
    expect(r.statusCode).toBe(400)
    const eicar = multipart({ itemId: 'logo' }, { name: 'x.pdf', data: Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*')]) })
    expect((await a.inject({ method: 'POST', url: `/api/portal/${l.token}/files`, ...eicar })).statusCode).toBe(400)
  })
})

describe('signed URL route', () => {
  it('serves within TTL and refuses after expiry', async () => {
    const s = await httpLogin(a, A.email)
    const l = await issueLink(env.ctx, A.owner, caseA)
    const up = multipart({ itemId: 'product_images' }, { name: 'img.png', data: makePng(5, 5, 5) })
    const fid = (await a.inject({ method: 'POST', url: `/api/portal/${l.token}/files`, ...up })).json().fileId
    const u = (await a.inject({ method: 'GET', url: `/api/files/${fid}/url`, headers: { cookie: s.cookie } })).json().url
    const ok = await a.inject({ method: 'GET', url: u })
    expect(ok.statusCode).toBe(200); expect(ok.headers['content-security-policy']).toContain('sandbox')
    env.clock.advance(10 * 60_000)
    expect((await a.inject({ method: 'GET', url: u })).statusCode).toBe(403)
    env.clock.advance(-10 * 60_000)
  })
})

describe('#22 search tenant filter', () => {
  it('search results only contain the caller org', async () => {
    const sa = await httpLogin(a, A.email)
    const ra = (await a.inject({ method: 'GET', url: `/api/search?q=${encodeURIComponent('ひみつ語')}`, headers: { cookie: sa.cookie } })).json()
    expect(ra).toEqual([])
    const sb = await httpLogin(a, B.email)
    const rb = (await a.inject({ method: 'GET', url: `/api/search?q=${encodeURIComponent('ひみつ語')}`, headers: { cookie: sb.cookie } })).json()
    expect(rb.length).toBeGreaterThan(0)
    const ra2 = (await a.inject({ method: 'GET', url: `/api/search?q=${encodeURIComponent('株式会社A')}`, headers: { cookie: sa.cookie } })).json()
    expect(ra2.some((r: any) => r.entity_type === 'response')).toBe(true)
    // LIKE wildcards are escaped
    const wild = (await a.inject({ method: 'GET', url: `/api/search?q=${encodeURIComponent('%')}`, headers: { cookie: sa.cookie } })).json()
    expect(wild).toEqual([])
  })
})

describe('#30 audit log', () => {
  it('records link issue/revoke, responses, uploads with actor types and no answer bodies', async () => {
    const rows = (await env.ctx.db.query('SELECT action, actor_type, meta FROM audit_logs WHERE org_id=$1', [A.orgId])).rows
    const actions = new Set(rows.map((r) => r.action))
    for (const x of ['template.create', 'template.publish', 'case.create', 'link.issue', 'link.revoke', 'link.reissue', 'response.save', 'file.upload', 'client.submit', 'member.add', 'auth.login', 'file.upload_rejected', 'file.malware_detected']) expect(actions).toContain(x)
    expect(rows.some((r) => r.actor_type === 'client')).toBe(true)
    expect(JSON.stringify(rows)).not.toContain('株式会社A')
  })
})

describe('URL ingestion (SSRF) route', () => {
  it('is disabled by default and rejects internal addresses when enabled', async () => {
    const s = await httpLogin(a, A.email)
    const h = { cookie: s.cookie, 'x-csrf-token': s.csrf }
    expect((await a.inject({ method: 'POST', url: `/api/cases/${caseA}/reference-title`, headers: h, payload: { url: 'http://169.254.169.254/' } })).statusCode).toBe(403)
    await a.inject({ method: 'PATCH', url: '/api/org/settings', headers: h, payload: { allowUrlTitleFetch: true } })
    const r = await a.inject({ method: 'POST', url: `/api/cases/${caseA}/reference-title`, headers: h, payload: { url: 'http://169.254.169.254/latest/meta-data' } })
    expect(r.statusCode).toBe(400); expect(r.json().code).toBe('url_rejected')
    expect((await a.inject({ method: 'POST', url: `/api/cases/${caseA}/reference-title`, headers: h, payload: { url: 'http://localhost:8787/api/health' } })).statusCode).toBe(400)
  })
  it('lists connectors (built-in upload/export, external planned)', async () => {
    const s = await httpLogin(a, A.email)
    const r = (await a.inject({ method: 'GET', url: '/api/org/connectors', headers: { cookie: s.cookie } })).json()
    expect(r.filter((c: any) => c.status === 'built_in').map((c: any) => c.id)).toEqual(['upload', 'export'])
  })
})
