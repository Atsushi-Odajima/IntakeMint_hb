// Backup / Restore (organization scope) and CSV export.
// ZIP layout: manifest.json (schemaVersion, appVersion, checksums) + data/<table>.json + objects/<storage_key>
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate'
import type { Ctx, Actor } from './context'
import { badRequest, conflict } from './context'
import { requirePerm } from './rbac'
import { audit } from './audit'
import { sha256 } from '../security/crypto'
import { safeZipEntryPath } from '../security/paths'
import { toCsv } from '../security/csv'
import { loadState } from './cases'
import { SCHEMA_VERSION } from '../db/schema'
import type { Db } from '../db'

/** Restore order respects foreign keys. Sessions, API tokens, jobs and the AI index are intentionally excluded. */
export const BACKUP_TABLES = [
  'organizations', 'users', 'memberships', 'workspaces', 'templates', 'template_versions', 'cases', 'case_access_tokens',
  'responses', 'item_states', 'files', 'reviews', 'ai_candidates', 'followups', 'reminders', 'email_outbox',
  'notifications', 'packages', 'audit_logs', 'search_index', 'ai_calls',
] as const

const SELECT: Record<(typeof BACKUP_TABLES)[number], string> = {
  organizations: 'SELECT * FROM organizations WHERE id=$1',
  users: 'SELECT u.* FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.org_id=$1',
  memberships: 'SELECT * FROM memberships WHERE org_id=$1',
  workspaces: 'SELECT * FROM workspaces WHERE org_id=$1',
  templates: 'SELECT * FROM templates WHERE org_id=$1',
  template_versions: 'SELECT * FROM template_versions WHERE org_id=$1',
  cases: 'SELECT * FROM cases WHERE org_id=$1',
  case_access_tokens: 'SELECT * FROM case_access_tokens WHERE org_id=$1',
  responses: 'SELECT * FROM responses WHERE org_id=$1',
  item_states: 'SELECT * FROM item_states WHERE org_id=$1',
  files: 'SELECT * FROM files WHERE org_id=$1',
  reviews: 'SELECT * FROM reviews WHERE org_id=$1',
  ai_candidates: 'SELECT * FROM ai_candidates WHERE org_id=$1',
  followups: 'SELECT * FROM followups WHERE org_id=$1',
  reminders: 'SELECT * FROM reminders WHERE org_id=$1',
  email_outbox: 'SELECT * FROM email_outbox WHERE org_id=$1',
  notifications: 'SELECT * FROM notifications WHERE org_id=$1',
  packages: 'SELECT * FROM packages WHERE org_id=$1',
  audit_logs: 'SELECT * FROM audit_logs WHERE org_id=$1',
  search_index: 'SELECT * FROM search_index WHERE org_id=$1',
  ai_calls: 'SELECT * FROM ai_calls WHERE org_id=$1',
}

const ORDER: Partial<Record<string, string>> = { audit_logs: 'id' }

async function dump(db: Db, orgId: string) {
  const data: Record<string, any[]> = {}
  for (const t of BACKUP_TABLES) {
    const rows = (await db.query(SELECT[t] + (ORDER[t] ? ` ORDER BY ${ORDER[t]}` : ''), [orgId])).rows
    data[t] = rows
  }
  return data
}

export async function exportOrg(ctx: Ctx, actor: Actor): Promise<{ zip: Uint8Array; manifest: any }> {
  requirePerm(actor, 'export')
  const data = await dump(ctx.db, actor.orgId)
  const files: Record<string, Uint8Array> = {}
  const checksums: Record<string, string> = {}
  for (const [t, rows] of Object.entries(data)) {
    const u8 = strToU8(JSON.stringify(rows))
    files[`data/${t}.json`] = u8
    checksums[`data/${t}.json`] = sha256(Buffer.from(u8))
  }
  let missingObjects = 0
  for (const f of data.files) {
    const buf = await ctx.storage.get(f.storage_key)
    if (!buf) { missingObjects++; continue }
    files[`objects/${f.storage_key}`] = new Uint8Array(buf)
    checksums[`objects/${f.storage_key}`] = sha256(buf)
  }
  const manifest = {
    format: 'intakemint.backup', schemaVersion: SCHEMA_VERSION, appVersion: ctx.config.appVersion, exportedAt: ctx.now().toISOString(),
    orgId: actor.orgId, counts: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length])), missingObjects, checksums,
    fingerprint: await relationFingerprint(ctx.db, actor.orgId),
  }
  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2))
  await audit(ctx.db, actor, 'export.org', 'organization', actor.orgId, { counts: manifest.counts })
  return { zip: zipSync(files, { level: 6 }), manifest }
}

const MAX_TOTAL = 2 * 1024 * 1024 * 1024
const MAX_ENTRIES = 200_000

export function readBackupZip(buf: Uint8Array): { manifest: any; entries: Record<string, Uint8Array> } {
  let total = 0, count = 0
  const entries = unzipSync(buf, {
    filter: (f) => {
      count++
      total += f.originalSize
      if (count > MAX_ENTRIES || total > MAX_TOTAL) throw badRequest('バックアップが大きすぎます（展開サイズ上限）')
      if (!safeZipEntryPath(f.name)) throw badRequest(`不正なパスを含むZIPです: ${f.name.slice(0, 80)}`)
      return true
    },
  })
  for (const name of Object.keys(entries)) {
    const p = safeZipEntryPath(name)
    if (!p || !(p === 'manifest.json' || /^data\/[a-z_]+\.json$/.test(p) || p.startsWith('objects/'))) throw badRequest(`不正なパスを含むZIPです: ${name.slice(0, 80)}`)
  }
  if (!entries['manifest.json']) throw badRequest('manifest.json がありません')
  const manifest = JSON.parse(strFromU8(entries['manifest.json']))
  if (manifest.format !== 'intakemint.backup') throw badRequest('IntakeMintのバックアップではありません')
  if (manifest.schemaVersion > SCHEMA_VERSION) throw badRequest('新しいバージョンのバックアップです。アプリを更新してください')
  for (const [name, sum] of Object.entries(manifest.checksums as Record<string, string>)) {
    if (!entries[name] || sha256(Buffer.from(entries[name])) !== sum) throw badRequest(`チェックサム不一致: ${name}`)
  }
  return { manifest, entries }
}

async function columnTypes(db: Db, table: string): Promise<Record<string, string>> {
  const r = await db.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name=$1 AND table_schema = current_schema()`, [table])
  return Object.fromEntries(r.rows.map((x) => [x.column_name, x.data_type]))
}

/** Restore into an environment where this organization does not exist yet (e.g. empty environment). */
export async function restoreOrg(ctx: Ctx, buf: Uint8Array): Promise<{ orgId: string; counts: Record<string, number>; fingerprintMatch: boolean }> {
  const { manifest, entries } = readBackupZip(buf)
  const exists = await ctx.db.one('SELECT id FROM organizations WHERE id=$1', [manifest.orgId])
  if (exists) throw conflict('同じ組織がすでに存在します。空の環境に復元してください')
  const counts: Record<string, number> = {}
  await ctx.db.tx(async (db) => {
    for (const t of BACKUP_TABLES) {
      const raw = entries[`data/${t}.json`]
      const rows: any[] = raw ? JSON.parse(strFromU8(raw)) : []
      counts[t] = rows.length
      if (!rows.length) continue
      const types = await columnTypes(db, t)
      for (const row of rows) {
        const cols = Object.keys(row).filter((c) => c in types)
        const vals = cols.map((c) => (types[c] === 'jsonb' || types[c] === 'json') ? (row[c] === null ? null : JSON.stringify(row[c])) : row[c])
        const sql = `INSERT INTO ${t} (${cols.map((c) => `"${c}"`).join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')})${t === 'users' ? ' ON CONFLICT DO NOTHING' : ''}`
        await db.query(sql, vals)
      }
    }
    await db.query(`SELECT setval(pg_get_serial_sequence('audit_logs','id'), GREATEST((SELECT COALESCE(MAX(id),1) FROM audit_logs), 1))`)
  })
  for (const name of Object.keys(entries)) {
    if (!name.startsWith('objects/')) continue
    const key = name.slice('objects/'.length)
    const ex = await ctx.storage.get(key)
    if (!ex) await ctx.storage.put(key, Buffer.from(entries[name]), 'application/octet-stream')
  }
  const fp = await relationFingerprint(ctx.db, manifest.orgId)
  const fingerprintMatch = JSON.stringify(fp) === JSON.stringify(manifest.fingerprint)
  await audit(ctx.db, { type: 'system', orgId: manifest.orgId }, 'restore.org', 'organization', manifest.orgId, { counts, fingerprintMatch, from: manifest.exportedAt })
  return { orgId: manifest.orgId, counts, fingerprintMatch }
}

/** Per-table count + hash over primary keys and foreign keys; equal before/after restore => relations preserved. */
export async function relationFingerprint(db: Db, orgId: string): Promise<Record<string, { count: number; hash: string }>> {
  const q: Record<string, string> = {
    workspaces: `SELECT id::text AS k FROM workspaces WHERE org_id=$1`,
    memberships: `SELECT user_id||':'||role AS k FROM memberships WHERE org_id=$1`,
    templates: `SELECT id||':'||workspace_id||':'||COALESCE(current_version_id::text,'') AS k FROM templates WHERE org_id=$1`,
    template_versions: `SELECT id||':'||template_id||':'||version AS k FROM template_versions WHERE org_id=$1`,
    cases: `SELECT id||':'||template_version_id||':'||workspace_id||':'||status||':'||COALESCE(owner_id::text,'') AS k FROM cases WHERE org_id=$1`,
    responses: `SELECT case_id||':'||question_id||':'||md5(value::text) AS k FROM responses WHERE org_id=$1`,
    item_states: `SELECT case_id||':'||item_id||':'||review_status AS k FROM item_states WHERE org_id=$1`,
    files: `SELECT id||':'||case_id||':'||COALESCE(item_id,'')||':'||sha256||':'||status AS k FROM files WHERE org_id=$1`,
    reviews: `SELECT id||':'||case_id||':'||target_id||':'||decision AS k FROM reviews WHERE org_id=$1`,
    reminders: `SELECT id||':'||case_id||':'||dedupe_key||':'||status AS k FROM reminders WHERE org_id=$1`,
    packages: `SELECT id||':'||case_id||':'||version||':'||md5(markdown) AS k FROM packages WHERE org_id=$1`,
    followups: `SELECT id||':'||case_id||':'||status AS k FROM followups WHERE org_id=$1`,
    ai_candidates: `SELECT id||':'||case_id||':'||fingerprint||':'||status AS k FROM ai_candidates WHERE org_id=$1`,
    audit_logs: `SELECT id||':'||action AS k FROM audit_logs WHERE org_id=$1`,
  }
  const out: Record<string, { count: number; hash: string }> = {}
  for (const [t, sql] of Object.entries(q)) {
    const keys = (await db.query(sql, [orgId])).rows.map((r) => r.k as string).sort()
    out[t] = { count: keys.length, hash: sha256(keys.join('\n')).slice(0, 16) }
  }
  return out
}

export async function exportCaseCsv(ctx: Ctx, actor: Actor, caseId: string): Promise<string> {
  requirePerm(actor, 'read')
  const st = await loadState(ctx.db, actor.orgId, caseId)
  const rows: unknown[][] = [['section', 'question_id', 'question', 'visible', 'answer']]
  for (const q of st.def.questions) {
    const sec = st.def.sections.find((s) => s.id === q.sectionId)?.title ?? ''
    rows.push([sec, q.id, q.label, st.result.logic.visible[q.id] !== false ? 'yes' : 'no(hidden)', st.answers[q.id] ?? ''])
  }
  rows.push([], ['item_id', 'item', 'status', 'count', 'min'])
  for (const i of st.result.items) rows.push([i.itemId, i.label, i.status, i.count ?? '', i.minCount ?? ''])
  await audit(ctx.db, actor, 'export.case_csv', 'case', caseId, {})
  return toCsv(rows)
}
