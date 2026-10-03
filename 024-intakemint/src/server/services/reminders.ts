// Reminder Engine: before / on / after targetReadyDate, missing items only, idempotent (unique dedupe_key),
// timezone + quiet hours aware. Default mode is "draft": a human approves before anything is sent.
import type { Db } from '../db'
import type { Ctx, Actor } from './context'
import { badRequest, conflict, notFound } from './context'
import { requirePerm } from './rbac'
import { audit } from './audit'
import { notify } from './notifications'
import { loadState, orgSettings } from './cases'
import { enqueue } from '../jobs/queue'
import { STATUS_LABEL } from '../../shared/completeness'
import { DEFAULT_REMINDER_POLICY, type ReminderPolicy } from '../../shared/types'
import { issueLink } from './access'

/** Local date (YYYY-MM-DD) and minutes-of-day in a timezone. */
export function localParts(d: Date, tz: string): { date: string; minutes: number } {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]))
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) }
}

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))

export function inQuietHours(d: Date, tz: string, q: ReminderPolicy['quietHours']): boolean {
  const m = localParts(d, tz).minutes, s = toMin(q.start), e = toMin(q.end)
  return s <= e ? m >= s && m < e : m >= s || m < e
}

/** Next instant (minute resolution) outside quiet hours. */
export function nextAllowed(d: Date, tz: string, q: ReminderPolicy['quietHours']): Date {
  let t = new Date(d.getTime())
  for (let i = 0; i < 24 * 60 && inQuietHours(t, tz, q); i += 5) t = new Date(t.getTime() + 5 * 60_000)
  return t
}

function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400_000)
}

export function reminderStage(target: string, today: string, p: ReminderPolicy): string | null {
  const diff = dayDiff(target, today)
  if (diff > 0 && p.daysBefore.includes(diff)) return `before_${diff}`
  if (diff === 0 && p.onDueDate) return 'due'
  if (diff < 0) {
    const late = -diff
    if (late % p.overdueEveryDays === 0 && late / p.overdueEveryDays <= p.maxOverdue) return `overdue_${late / p.overdueEveryDays}`
  }
  return null
}

function fmtDate(s: string | Date | null): string {
  if (!s) return ''
  const d = typeof s === 'string' ? s.slice(0, 10) : s.toISOString().slice(0, 10)
  return d
}

/** Create reminder for a case if one is due now. Returns the reminder id or null. Never duplicates (dedupe_key). */
export async function planReminder(ctx: Ctx, db: Db, orgId: string, caseId: string, opts: { manualStage?: string } = {}): Promise<string | null> {
  const st = await loadState(db, orgId, caseId)
  const c = st.row
  if (['draft', 'ready', 'started', 'archived', 'cancelled'].includes(c.status)) return null
  const policy = { ...DEFAULT_REMINDER_POLICY, ...(st.def.reminderPolicy ?? {}) }
  if (!policy.enabled && !opts.manualStage) return null
  const settings = await orgSettings(db, orgId)
  const tz = c.timezone || settings.timezone
  const today = localParts(ctx.now(), tz).date
  const target = c.target_ready_date ? fmtDate(c.target_ready_date) : null
  const stage = opts.manualStage ?? (target ? reminderStage(target, today, policy) : null)
  if (!stage) return null
  const missing = st.result.items.filter((i) => i.applicable && i.required && ['missing', 'partial', 'rejected'].includes(i.status))
  const followups = (await db.query(`SELECT id, text FROM followups WHERE case_id=$1 AND status='open'`, [caseId])).rows
  if (!missing.length && !followups.length) return null
  const lines = [
    ...missing.map((i) => `・${i.label}：${STATUS_LABEL[i.status]}${i.type === 'file' && i.status === 'partial' ? `（${i.count}/${i.minCount}）` : ''}${i.status === 'rejected' && i.note ? `（差し戻し理由：${i.note}）` : ''}`),
    ...followups.map((f) => `・追加のご質問：${String(f.text).slice(0, 80)}`),
  ]
  const when = stage.startsWith('before') ? `ご提出期限（${target}）が近づいています。` : stage === 'due' ? `本日がご提出期限（${target}）です。` : stage.startsWith('overdue') ? `ご提出期限（${target}）を過ぎています。` : ''
  const subject = `【${settings.branding.senderName}】${c.project_name}：ご提出のお願い（残り${lines.length}件）`
  const body = `${c.client_name} 様\n\n${when}\n以下の項目がまだ揃っていません。\n\n${lines.join('\n')}\n\nお送りしているリンクから、続きを入力・アップロードできます。\nご不明点はこのメールへの返信でお知らせください。\n\n${settings.branding.senderName}`
  const scheduled = nextAllowed(ctx.now(), tz, policy.quietHours)
  const dedupeKey = opts.manualStage ? `${caseId}:manual:${ctx.now().toISOString().slice(0, 16)}` : `${caseId}:${stage}:${target}`
  const r = await db.one<{ id: string }>(
    `INSERT INTO reminders (org_id, case_id, stage, dedupe_key, scheduled_for, status, items, subject, body) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`,
    [orgId, caseId, stage, dedupeKey, scheduled, policy.mode === 'auto' ? 'approved' : 'draft', JSON.stringify(missing.map((i) => ({ itemId: i.itemId, label: i.label, status: i.status, count: i.count, minCount: i.minCount }))), subject, body],
  )
  if (!r) return null
  await audit(db, { type: 'system', orgId }, 'reminder.planned', 'case', caseId, { reminderId: r.id, stage, mode: policy.mode })
  if (stage.startsWith('overdue')) await notify(db, orgId, caseId, 'overdue', `期限超過: ${c.project_name}`, ctx.now())
  if (policy.mode === 'auto') await enqueue(db, 'send_reminder', { orgId, reminderId: r.id }, { runAt: scheduled, dedupeKey: `rem:${r.id}` })
  return r.id
}

export async function scanReminders(ctx: Ctx): Promise<number> {
  const rows = (await ctx.db.query(`SELECT id, org_id FROM cases WHERE target_ready_date IS NOT NULL AND status IN ('sent','in_progress','needs_client','needs_internal_review')`)).rows
  let n = 0
  for (const r of rows) if (await planReminder(ctx, ctx.db, r.org_id, r.id)) n++
  return n
}

export async function draftManualReminder(ctx: Ctx, actor: Actor, caseId: string) {
  requirePerm(actor, 'case.edit')
  const c = await ctx.db.one('SELECT id FROM cases WHERE id=$1 AND org_id=$2', [caseId, actor.orgId])
  if (!c) throw notFound('案件')
  const id = await planReminder(ctx, ctx.db, actor.orgId, caseId, { manualStage: 'manual' })
  if (!id) throw conflict('催促する未提出項目がありません（または受付状態ではありません）')
  await audit(ctx.db, actor, 'reminder.draft', 'case', caseId, { reminderId: id })
  return id
}

/** Human approval of a draft. Optionally edits the text and/or attaches a freshly issued client link. */
export async function approveReminder(ctx: Ctx, actor: Actor, reminderId: string, opts: { subject?: string; body?: string; includeNewLink?: boolean } = {}) {
  requirePerm(actor, 'reminder.send')
  const r = await ctx.db.one('SELECT r.*, c.client_email FROM reminders r JOIN cases c ON c.id=r.case_id WHERE r.id=$1 AND r.org_id=$2', [reminderId, actor.orgId])
  if (!r) throw notFound('リマインド')
  if (r.status !== 'draft') throw conflict('下書き以外のリマインドは承認できません')
  if (!r.client_email) throw badRequest('クライアントのメールアドレスが未設定です')
  let body = (opts.body ?? r.body).slice(0, 8000)
  if (opts.includeNewLink) { const l = await issueLink(ctx, actor, r.case_id, {}); body += `\n\n入力用リンク（${l.expiresAt.slice(0, 10)}まで有効）：\n${l.url}` }
  await ctx.db.query(`UPDATE reminders SET status='approved', subject=$2, body=$3, approved_by=$4 WHERE id=$1`, [reminderId, (opts.subject ?? r.subject).slice(0, 300), body, actor.userId ?? null])
  await audit(ctx.db, actor, 'reminder.approve', 'case', r.case_id, { reminderId })
  await enqueue(ctx.db, 'send_reminder', { orgId: actor.orgId, reminderId }, { runAt: new Date(Math.max(ctx.now().getTime(), new Date(r.scheduled_for).getTime())), dedupeKey: `rem:${reminderId}` })
}

export async function cancelReminder(ctx: Ctx, actor: Actor, reminderId: string) {
  requirePerm(actor, 'case.edit')
  const r = await ctx.db.query(`UPDATE reminders SET status='cancelled' WHERE id=$1 AND org_id=$2 AND status IN ('draft','approved') RETURNING case_id`, [reminderId, actor.orgId])
  if (!r.rowCount) throw notFound('リマインド')
  await audit(ctx.db, actor, 'reminder.cancel', 'case', r.rows[0].case_id, { reminderId })
}

/** Job: move an approved reminder into the email outbox (respects quiet hours and current missing state). */
export async function dispatchReminder(ctx: Ctx, orgId: string, reminderId: string): Promise<'queued' | 'deferred' | 'skipped'> {
  const r = await ctx.db.one('SELECT r.*, c.client_email, c.timezone, c.status AS case_status, c.template_version_id FROM reminders r JOIN cases c ON c.id=r.case_id WHERE r.id=$1 AND r.org_id=$2', [reminderId, orgId])
  if (!r || r.status !== 'approved') return 'skipped'
  if (['ready', 'started', 'archived', 'cancelled'].includes(r.case_status) || !r.client_email) {
    await ctx.db.query(`UPDATE reminders SET status='skipped' WHERE id=$1`, [reminderId]); return 'skipped'
  }
  const st = await loadState(ctx.db, orgId, r.case_id)
  const policy = { ...DEFAULT_REMINDER_POLICY, ...(st.def.reminderPolicy ?? {}) }
  if (inQuietHours(ctx.now(), r.timezone, policy.quietHours)) {
    await enqueue(ctx.db, 'send_reminder', { orgId, reminderId }, { runAt: nextAllowed(ctx.now(), r.timezone, policy.quietHours), dedupeKey: `rem:${reminderId}:q` })
    return 'deferred'
  }
  const settings = await orgSettings(ctx.db, orgId)
  const email = await queueEmail(ctx.db, { orgId, caseId: r.case_id, to: r.client_email, fromName: settings.branding.senderName, subject: r.subject, body: r.body })
  await ctx.db.query(`UPDATE reminders SET status='sent', email_id=$2, sent_at=$3 WHERE id=$1`, [reminderId, email, ctx.now()])
  await audit(ctx.db, { type: 'system', orgId }, 'reminder.sent', 'case', r.case_id, { reminderId, emailId: email })
  return 'queued'
}

export async function queueEmail(db: Db, m: { orgId: string; caseId?: string; to: string; fromName: string; subject: string; body: string }): Promise<string> {
  const e = await db.one<{ id: string }>('INSERT INTO email_outbox (org_id, case_id, to_address, from_name, subject, body) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
    [m.orgId, m.caseId ?? null, m.to, m.fromName, m.subject, m.body])
  await enqueue(db, 'send_email', { emailId: e!.id }, { dedupeKey: `email:${e!.id}`, maxAttempts: 4 })
  return e!.id
}

export async function deliverEmail(ctx: Ctx, emailId: string, attempt: number, maxAttempts: number): Promise<void> {
  const e = await ctx.db.one('SELECT * FROM email_outbox WHERE id=$1', [emailId])
  if (!e || e.status === 'sent') return
  try {
    const res = await ctx.email.send({ to: e.to_address, fromName: e.from_name, subject: e.subject, body: e.body })
    await ctx.db.query(`UPDATE email_outbox SET status='sent', attempts=$2, provider=$3, provider_message_id=$4, sent_at=$5, last_error=NULL WHERE id=$1`, [emailId, attempt, ctx.email.name, res.id, ctx.now()])
  } catch (err) {
    const final = attempt >= maxAttempts
    await ctx.db.query(`UPDATE email_outbox SET status=$2, attempts=$3, last_error=$4, provider=$5 WHERE id=$1`, [emailId, final ? 'failed' : 'queued', attempt, String((err as Error).message).slice(0, 300), ctx.email.name])
    if (final) {
      await ctx.db.query(`UPDATE reminders SET status='failed' WHERE email_id=$1`, [emailId])
      await notify(ctx.db, e.org_id, e.case_id, 'reminder_failure', `メール送信に失敗しました（${e.to_address.replace(/(.{2}).*@/, '$1***@')}）`, ctx.now())
      await audit(ctx.db, { type: 'system', orgId: e.org_id }, 'email.failed', 'email', emailId, { attempts: attempt })
    }
    throw err
  }
}
