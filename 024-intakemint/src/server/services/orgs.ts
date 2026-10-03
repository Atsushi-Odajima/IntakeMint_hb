// Organizations, users, memberships, sessions, API tokens (MCP).
import type { Ctx, Actor } from './context'
import { HttpError, badRequest, conflict, forbidden, notFound } from './context'
import { requirePerm } from './rbac'
import { audit } from './audit'
import { hashPassword, randomToken, sha256, verifyPassword } from '../security/crypto'
import { orgSettings, type OrgSettings } from './cases'
import type { Role } from '../../shared/types'
import type { Db } from '../db'

export async function signup(ctx: Ctx, input: { orgName: string; email: string; name: string; password: string }) {
  if (input.password.length < 10) throw badRequest('パスワードは10文字以上にしてください')
  const exists = await ctx.db.one('SELECT id FROM users WHERE lower(email)=lower($1)', [input.email])
  if (exists) throw conflict('このメールアドレスは登録済みです')
  return ctx.db.tx(async (db) => {
    const slug = `org-${randomToken(6).toLowerCase().replace(/[^a-z0-9]/g, '')}`
    const org = await db.one<{ id: string }>('INSERT INTO organizations (name, slug) VALUES ($1,$2) RETURNING id', [input.orgName, slug])
    const user = await db.one<{ id: string }>('INSERT INTO users (email, name, password_hash) VALUES ($1,$2,$3) RETURNING id', [input.email.trim(), input.name, hashPassword(input.password)])
    await db.query(`INSERT INTO memberships (org_id, user_id, role) VALUES ($1,$2,'owner')`, [org!.id, user!.id])
    await db.query(`INSERT INTO workspaces (org_id, name) VALUES ($1,'メイン')`, [org!.id])
    await audit(db, { type: 'user', orgId: org!.id, userId: user!.id }, 'org.create', 'organization', org!.id, {})
    return { orgId: org!.id, userId: user!.id }
  })
}

export async function login(ctx: Ctx, email: string, password: string, ip?: string) {
  const u = await ctx.db.one('SELECT id, password_hash, disabled FROM users WHERE lower(email)=lower($1)', [email])
  // constant-ish work even for unknown users
  const ok = verifyPassword(password, u?.password_hash ?? 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$' + 'A'.repeat(86))
  if (!u || !ok || u.disabled) throw new HttpError(401, 'メールアドレスまたはパスワードが正しくありません', 'invalid_credentials')
  const m = await ctx.db.one('SELECT org_id FROM memberships WHERE user_id=$1 ORDER BY created_at LIMIT 1', [u.id])
  const token = randomToken(32)
  const csrf = randomToken(24)
  const expires = new Date(ctx.now().getTime() + ctx.config.sessionTtlHours * 3600_000)
  await ctx.db.query('INSERT INTO sessions (token_hash, user_id, org_id, csrf_token, expires_at) VALUES ($1,$2,$3,$4,$5)', [sha256(token), u.id, m?.org_id ?? null, csrf, expires])
  if (m) await audit(ctx.db, { type: 'user', orgId: m.org_id, userId: u.id, ip }, 'auth.login', 'user', u.id, {})
  return { token, csrf, expires }
}

export async function logout(ctx: Ctx, token: string) {
  await ctx.db.query('DELETE FROM sessions WHERE token_hash=$1', [sha256(token)])
}

export interface SessionInfo { userId: string; orgId: string; role: Role; csrf: string; name: string; email: string }

export async function resolveSession(ctx: Ctx, token: string | undefined): Promise<SessionInfo | null> {
  if (!token) return null
  const s = await ctx.db.one(
    `SELECT s.user_id, s.org_id, s.csrf_token, s.expires_at, u.name, u.email, u.disabled, m.role FROM sessions s JOIN users u ON u.id=s.user_id
     LEFT JOIN memberships m ON m.user_id=s.user_id AND m.org_id=s.org_id WHERE s.token_hash=$1`, [sha256(token)])
  if (!s || s.disabled || !s.role || new Date(s.expires_at).getTime() < ctx.now().getTime()) return null
  return { userId: s.user_id, orgId: s.org_id, role: s.role, csrf: s.csrf_token, name: s.name, email: s.email }
}

export async function switchOrg(ctx: Ctx, token: string, userId: string, orgId: string) {
  const m = await ctx.db.one('SELECT role FROM memberships WHERE user_id=$1 AND org_id=$2', [userId, orgId])
  if (!m) throw forbidden()
  await ctx.db.query('UPDATE sessions SET org_id=$2 WHERE token_hash=$1', [sha256(token), orgId])
}

export async function listMyOrgs(ctx: Ctx, userId: string) {
  return (await ctx.db.query('SELECT o.id, o.name, m.role, o.is_sample FROM memberships m JOIN organizations o ON o.id=m.org_id WHERE m.user_id=$1 ORDER BY o.created_at', [userId])).rows
}

export async function listMembers(ctx: Ctx, actor: Actor) {
  requirePerm(actor, 'read')
  return (await ctx.db.query('SELECT u.id, u.name, u.email, m.role, m.created_at FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.org_id=$1 ORDER BY m.created_at', [actor.orgId])).rows
}

/** Adds a member. In this foundation the admin sets an initial password; invitation emails go through the outbox. */
export async function addMember(ctx: Ctx, actor: Actor, input: { email: string; name: string; role: Role; password?: string }) {
  requirePerm(actor, 'members.manage')
  if (input.role === 'owner' && actor.role !== 'owner') throw forbidden('Ownerの付与はOwnerのみ可能です')
  return ctx.db.tx(async (db) => {
    let u = await db.one('SELECT id FROM users WHERE lower(email)=lower($1)', [input.email])
    if (!u) {
      if (!input.password || input.password.length < 10) throw badRequest('初期パスワード（10文字以上）を設定してください')
      u = await db.one('INSERT INTO users (email, name, password_hash) VALUES ($1,$2,$3) RETURNING id', [input.email.trim(), input.name, hashPassword(input.password)])
    }
    const r = await db.query('INSERT INTO memberships (org_id, user_id, role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [actor.orgId, u.id, input.role])
    if (!r.rowCount) throw conflict('すでにメンバーです')
    await audit(db, actor, 'member.add', 'user', u.id, { role: input.role })
    return u.id as string
  })
}

export async function changeRole(ctx: Ctx, actor: Actor, userId: string, role: Role) {
  requirePerm(actor, 'members.manage')
  const m = await ctx.db.one('SELECT role FROM memberships WHERE org_id=$1 AND user_id=$2', [actor.orgId, userId])
  if (!m) throw notFound('メンバー')
  if ((role === 'owner' || m.role === 'owner') && actor.role !== 'owner') throw forbidden('Ownerの変更はOwnerのみ可能です')
  if (m.role === 'owner' && role !== 'owner') {
    const owners = await ctx.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM memberships WHERE org_id=$1 AND role='owner'`, [actor.orgId])
    if (owners!.n <= 1) throw conflict('最後のOwnerは変更できません')
  }
  await ctx.db.query('UPDATE memberships SET role=$3 WHERE org_id=$1 AND user_id=$2', [actor.orgId, userId, role])
  await audit(ctx.db, actor, 'member.role_change', 'user', userId, { from: m.role, to: role })
}

export async function removeMember(ctx: Ctx, actor: Actor, userId: string) {
  requirePerm(actor, 'members.manage')
  const m = await ctx.db.one('SELECT role FROM memberships WHERE org_id=$1 AND user_id=$2', [actor.orgId, userId])
  if (!m) throw notFound('メンバー')
  if (m.role === 'owner') throw conflict('Ownerは削除できません（先にロールを変更してください）')
  await ctx.db.query('DELETE FROM memberships WHERE org_id=$1 AND user_id=$2', [actor.orgId, userId])
  await ctx.db.query('DELETE FROM sessions WHERE user_id=$1 AND org_id=$2', [userId, actor.orgId])
  await audit(ctx.db, actor, 'member.remove', 'user', userId, {})
}

export async function updateSettings(ctx: Ctx, actor: Actor, patch: Partial<OrgSettings>) {
  requirePerm(actor, 'org.manage')
  const cur = await orgSettings(ctx.db, actor.orgId)
  const next: OrgSettings = { ...cur, ...patch, branding: { ...cur.branding, ...(patch.branding ?? {}) } }
  if (next.branding.logoDataUrl && (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(next.branding.logoDataUrl) || next.branding.logoDataUrl.length > 300_000)) {
    throw badRequest('ロゴはPNG/JPEG/WebP（200KB程度まで）にしてください')
  }
  if (!/^#[0-9A-Fa-f]{6}$/.test(next.branding.color)) throw badRequest('ブランドカラーは #RRGGBB 形式で指定してください')
  try { new Intl.DateTimeFormat('en', { timeZone: next.timezone }) } catch { throw badRequest('タイムゾーンが正しくありません') }
  await ctx.db.query('UPDATE organizations SET settings=$2 WHERE id=$1', [actor.orgId, JSON.stringify(next)])
  if (patch.aiEnabled === false) {
    await ctx.db.query('DELETE FROM ai_documents WHERE org_id=$1', [actor.orgId])
  }
  await audit(ctx.db, actor, 'org.settings_update', 'organization', actor.orgId, { keys: Object.keys(patch) })
  return next
}

export async function createApiToken(ctx: Ctx, actor: Actor, name: string) {
  requirePerm(actor, 'token.manage')
  const token = `imt_${randomToken(32)}`
  const r = await ctx.db.one<{ id: string }>('INSERT INTO api_tokens (org_id, user_id, name, token_hash) VALUES ($1,$2,$3,$4) RETURNING id', [actor.orgId, actor.userId, name, sha256(token)])
  await audit(ctx.db, actor, 'api_token.create', 'api_token', r!.id, { name })
  return { id: r!.id, token }
}

export async function revokeApiToken(ctx: Ctx, actor: Actor, id: string) {
  requirePerm(actor, 'token.manage')
  await ctx.db.query('UPDATE api_tokens SET revoked_at=now() WHERE id=$1 AND org_id=$2', [id, actor.orgId])
  await audit(ctx.db, actor, 'api_token.revoke', 'api_token', id, {})
}

export async function resolveApiToken(db: Db, token: string): Promise<Actor | null> {
  const r = await db.one(`SELECT t.id, t.org_id, t.user_id, m.role FROM api_tokens t JOIN memberships m ON m.org_id=t.org_id AND m.user_id=t.user_id WHERE t.token_hash=$1 AND t.revoked_at IS NULL`, [sha256(token)])
  if (!r) return null
  await db.query('UPDATE api_tokens SET last_used_at=now() WHERE id=$1', [r.id])
  return { type: 'mcp', orgId: r.org_id, userId: r.user_id, role: r.role }
}
