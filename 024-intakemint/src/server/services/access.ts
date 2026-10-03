// Client access links: random 256-bit token, only sha256 stored, expiring, revocable, re-issuable.
// No permanent public URLs. A token grants access to exactly one case.
import type { Ctx, Actor } from './context'
import { HttpError, badRequest, notFound } from './context'
import { requirePerm } from './rbac'
import { audit } from './audit'
import { recompute } from './cases'
import crypto from 'node:crypto'
import { randomToken, sha256 } from '../security/crypto'

export async function issueLink(ctx: Ctx, actor: Actor, caseId: string, opts: { days?: number; requireEmailVerification?: boolean; revokeExisting?: boolean } = {}) {
  requirePerm(actor, 'link.manage')
  const c = await ctx.db.one('SELECT id, client_email FROM cases WHERE id=$1 AND org_id=$2', [caseId, actor.orgId])
  if (!c) throw notFound('案件')
  const days = Math.min(Math.max(opts.days ?? ctx.config.clientLinkDefaultDays, 1), 90)
  if (opts.requireEmailVerification && !c.client_email) throw badRequest('メール確認を使うにはクライアントのメールアドレスを設定してください')
  const token = randomToken(32)
  const expires = new Date(ctx.now().getTime() + days * 86400_000)
  const row = await ctx.db.tx(async (db) => {
    if (opts.revokeExisting) {
      await db.query('UPDATE case_access_tokens SET revoked_at=$2 WHERE case_id=$1 AND revoked_at IS NULL', [caseId, ctx.now()])
    }
    const r = await db.one<{ id: string }>(
      'INSERT INTO case_access_tokens (org_id, case_id, token_hash, expires_at, require_email_verification, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [actor.orgId, caseId, sha256(token), expires, !!opts.requireEmailVerification, actor.userId ?? null],
    )
    await audit(db, actor, opts.revokeExisting ? 'link.reissue' : 'link.issue', 'case', caseId, { linkId: r!.id, expiresAt: expires.toISOString() })
    return r!
  })
  await recompute(ctx, ctx.db, actor.orgId, caseId, actor)
  // The raw token is returned once and never stored.
  return { linkId: row.id, token, url: `${ctx.config.publicBaseUrl}/p/${token}`, expiresAt: expires.toISOString() }
}

export async function revokeLink(ctx: Ctx, actor: Actor, caseId: string, linkId: string) {
  requirePerm(actor, 'link.manage')
  const r = await ctx.db.query('UPDATE case_access_tokens SET revoked_at=$4 WHERE id=$1 AND case_id=$2 AND org_id=$3 AND revoked_at IS NULL', [linkId, caseId, actor.orgId, ctx.now()])
  if (!r.rowCount) throw notFound('リンク')
  await audit(ctx.db, actor, 'link.revoke', 'case', caseId, { linkId })
}

export interface ClientSession { orgId: string; caseId: string; linkId: string; needsVerification: boolean }

/** Resolve a raw client token. Expired / revoked / unknown tokens are rejected with the same 401/410 semantics. */
export async function resolveToken(ctx: Ctx, token: string): Promise<ClientSession> {
  if (!token || token.length < 20 || token.length > 100) throw new HttpError(401, 'リンクが無効です', 'invalid_link')
  const r = await ctx.db.one('SELECT id, org_id, case_id, expires_at, revoked_at, require_email_verification, email_verified_at FROM case_access_tokens WHERE token_hash=$1', [sha256(token)])
  if (!r) throw new HttpError(401, 'リンクが無効です', 'invalid_link')
  if (r.revoked_at) throw new HttpError(410, 'このリンクは無効化されました。担当者に新しいリンクを依頼してください', 'link_revoked')
  if (new Date(r.expires_at).getTime() <= ctx.now().getTime()) throw new HttpError(410, 'このリンクは有効期限が切れています。担当者に新しいリンクを依頼してください', 'link_expired')
  const c = await ctx.db.one('SELECT status FROM cases WHERE id=$1', [r.case_id])
  if (!c || c.status === 'cancelled' || c.status === 'archived') throw new HttpError(410, 'この案件は受付を終了しました', 'case_closed')
  await ctx.db.query('UPDATE case_access_tokens SET last_used_at=$2 WHERE id=$1', [r.id, ctx.now()])
  return { orgId: r.org_id, caseId: r.case_id, linkId: r.id, needsVerification: r.require_email_verification && !r.email_verified_at }
}

/** Optional email verification: a 6-digit code (stored hashed) — sent through the email outbox. */
export async function startEmailVerification(ctx: Ctx, s: ClientSession): Promise<string> {
  const code = String(crypto.randomInt(100000, 1000000))
  await ctx.db.query('UPDATE case_access_tokens SET verification_code_hash=$2 WHERE id=$1', [s.linkId, sha256(code + s.linkId)])
  return code
}

export async function verifyEmailCode(ctx: Ctx, s: ClientSession, code: string): Promise<boolean> {
  const r = await ctx.db.one('SELECT verification_code_hash FROM case_access_tokens WHERE id=$1', [s.linkId])
  if (!r?.verification_code_hash || r.verification_code_hash !== sha256(code + s.linkId)) return false
  await ctx.db.query('UPDATE case_access_tokens SET email_verified_at=$2, verification_code_hash=NULL WHERE id=$1', [s.linkId, ctx.now()])
  return true
}
