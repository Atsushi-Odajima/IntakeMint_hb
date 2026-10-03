// Background worker: processes queued jobs and schedules the periodic reminder scan / retention purge.
import type { Ctx } from '../services/context'
import { claim, complete, enqueue, fail } from './queue'
import { runCaseAnalysis } from '../services/ai'
import { deliverEmail, dispatchReminder, scanReminders } from '../services/reminders'
import { audit } from '../services/audit'
import { orgSettings } from '../services/cases'

export async function runJobsOnce(ctx: Ctx, limit = 20): Promise<number> {
  const jobs = await claim(ctx.db, ctx.now(), limit)
  for (const job of jobs) {
    try {
      switch (job.type) {
        case 'ai_case_analysis': await runCaseAnalysis(ctx, job.payload.orgId, job.payload.caseId, { type: 'system', orgId: job.payload.orgId }); break
        case 'send_reminder': await dispatchReminder(ctx, job.payload.orgId, job.payload.reminderId); break
        case 'send_email': await deliverEmail(ctx, job.payload.emailId, job.attempts, job.max_attempts); break
        case 'reminder_scan': await scanReminders(ctx); break
        case 'retention_purge': await purgeExpired(ctx); break
        default: throw new Error(`unknown job ${job.type}`)
      }
      await complete(ctx.db, job.id)
    } catch (e) {
      await fail(ctx.db, job, String((e as Error).message ?? e), ctx.now())
    }
  }
  return jobs.length
}

/** Archived / cancelled cases older than the org retention period are deleted (files, AI index, search index included). */
export async function purgeExpired(ctx: Ctx): Promise<number> {
  const orgs = (await ctx.db.query('SELECT id FROM organizations')).rows
  let n = 0
  for (const o of orgs) {
    const s = await orgSettings(ctx.db, o.id)
    const cutoff = new Date(ctx.now().getTime() - s.retentionDays * 86400_000)
    const old = (await ctx.db.query(`SELECT id FROM cases WHERE org_id=$1 AND status IN ('archived','cancelled') AND last_activity_at < $2`, [o.id, cutoff])).rows
    for (const c of old) {
      const keys = (await ctx.db.query('SELECT storage_key FROM files WHERE case_id=$1', [c.id])).rows
      await ctx.db.query('DELETE FROM ai_documents WHERE case_id=$1', [c.id])
      await ctx.db.query('DELETE FROM search_index WHERE case_id=$1', [c.id])
      await ctx.db.query('DELETE FROM cases WHERE id=$1', [c.id])
      for (const k of keys) await ctx.storage.delete(k.storage_key).catch(() => {})
      await audit(ctx.db, { type: 'system', orgId: o.id }, 'case.retention_purge', 'case', c.id, {})
      n++
    }
  }
  return n
}

export function startWorker(ctx: Ctx, intervalMs = 3000): () => void {
  let stopped = false
  let lastScan = 0
  const tick = async () => {
    if (stopped) return
    try {
      if (Date.now() - lastScan > 15 * 60_000) {
        lastScan = Date.now()
        const hour = ctx.now().toISOString().slice(0, 13)
        await enqueue(ctx.db, 'reminder_scan', {}, { dedupeKey: `scan:${hour}` })
        await enqueue(ctx.db, 'retention_purge', {}, { dedupeKey: `purge:${hour.slice(0, 10)}` })
      }
      while ((await runJobsOnce(ctx)) > 0 && !stopped) { /* drain */ }
    } catch (e) { console.error('[worker]', (e as Error).message) }
    if (!stopped) timer = setTimeout(tick, intervalMs)
  }
  let timer = setTimeout(tick, 500)
  return () => { stopped = true; clearTimeout(timer) }
}
