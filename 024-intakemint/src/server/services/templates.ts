// Templates & immutable versions. Published versions are never overwritten: publishing creates version N+1.
// Existing cases keep the version they were created with.
import { z } from 'zod'
import type { Ctx, Actor } from './context'
import { badRequest, notFound } from './context'
import { requirePerm } from './rbac'
import { audit } from './audit'
import { detectCycles } from '../../shared/logic'
import { QUESTION_TYPES, FILE_CATEGORIES, DEFAULT_COMPLETION_RULES, DEFAULT_REMINDER_POLICY, type TemplateDefinition } from '../../shared/types'
import { sampleTemplates } from '../../shared/sampleTemplates'
import type { Db } from '../db'

const id = z.string().regex(/^[A-Za-z0-9_\-:]{1,64}$/)
const cond: z.ZodType<any> = z.lazy(() => z.union([
  z.object({ questionId: id, op: z.enum(['eq', 'neq', 'in', 'contains', 'gt', 'gte', 'lt', 'lte', 'answered', 'not_answered']), value: z.unknown().optional() }),
  z.object({ all: z.array(cond).max(50) }),
  z.object({ any: z.array(cond).max(50) }),
  z.object({ not: cond }),
]))

export const definitionSchema = z.object({
  sections: z.array(z.object({ id, title: z.string().min(1).max(200), description: z.string().max(2000).optional() })).max(50),
  questions: z.array(z.object({
    id, sectionId: id, type: z.enum(QUESTION_TYPES), label: z.string().min(1).max(500), help: z.string().max(2000).optional(),
    placeholder: z.string().max(200).optional(), required: z.boolean().optional(), visibleByDefault: z.boolean().optional(),
    options: z.array(z.object({ value: z.string().min(1).max(100), label: z.string().min(1).max(200) })).max(100).optional(),
    min: z.number().optional(), max: z.number().optional(), maxLength: z.number().int().positive().max(20000).optional(),
    fields: z.array(z.object({ id, label: z.string().max(200), type: z.enum(['short_text', 'long_text', 'url', 'number', 'email']) })).max(20).optional(),
    minRows: z.number().int().min(0).optional(), maxRows: z.number().int().positive().max(100).optional(),
    fileItemId: id.optional(), tags: z.array(z.string().max(50)).max(20).optional(),
  })).max(500),
  rules: z.array(z.object({
    id, description: z.string().max(500).optional(), when: cond,
    then: z.array(z.object({ type: z.enum(['show', 'hide', 'require', 'unrequire']), target: id })).min(1).max(50),
    status: z.enum(['active', 'draft']).optional(), origin: z.enum(['human', 'ai']).optional(),
  })).max(300),
  requiredItems: z.array(z.object({
    id, label: z.string().min(1).max(200), type: z.enum(['question', 'file']), required: z.boolean(),
    questionIds: z.array(id).max(50).optional(), minCount: z.number().int().min(1).max(500).optional(), maxCount: z.number().int().min(1).max(1000).optional(),
    acceptedFormats: z.array(z.string().regex(/^[a-z0-9]{1,8}$/)).max(30).optional(), maxSizeMB: z.number().positive().max(2048).optional(),
    requireReview: z.boolean().optional(), visibleByDefault: z.boolean().optional(), dueOffsetDays: z.number().int().optional(),
    notes: z.string().max(2000).optional(), category: z.enum(FILE_CATEGORIES).optional(),
  })).max(200),
  completionRules: z.object({
    aiUnresolvedPolicy: z.enum(['block', 'warn', 'ignore']), requireInternalSignoff: z.boolean(), autoAcceptAnswers: z.boolean(), requireFileReview: z.boolean(),
  }).default(DEFAULT_COMPLETION_RULES),
  reminderPolicy: z.object({
    enabled: z.boolean(), mode: z.enum(['draft', 'auto']), daysBefore: z.array(z.number().int().min(1).max(60)).max(5), onDueDate: z.boolean(),
    overdueEveryDays: z.number().int().min(1).max(30), maxOverdue: z.number().int().min(0).max(20),
    quietHours: z.object({ start: z.string().regex(/^\d{2}:\d{2}$/), end: z.string().regex(/^\d{2}:\d{2}$/) }),
  }).default(DEFAULT_REMINDER_POLICY),
  packageTemplate: z.object({
    profile: z.enum(['web_development', 'design', 'video', 'sns_management', 'consulting', 'recruiting', 'accounting_prep', 'generic']),
    mapping: z.record(z.string(), z.array(id)).default({}),
  }),
  hiddenAnswerPolicy: z.literal('retain_excluded').optional(),
  intro: z.string().max(4000).optional(),
  completionMessage: z.string().max(4000).optional(),
})

/** Structural checks beyond the schema: unique ids, dangling references, cycles. */
export function lintDefinition(def: TemplateDefinition): { errors: string[]; warnings: string[] } {
  const errors: string[] = []; const warnings: string[] = []
  const qids = new Set<string>(); const sids = new Set(def.sections.map((s) => s.id)); const iids = new Set<string>()
  for (const q of def.questions) {
    if (qids.has(q.id)) errors.push(`質問IDが重複しています: ${q.id}`)
    qids.add(q.id)
    if (!sids.has(q.sectionId)) errors.push(`質問 ${q.id} のセクション ${q.sectionId} が存在しません`)
    if ((q.type === 'single_choice' || q.type === 'multiple_choice') && !(q.options?.length)) errors.push(`選択式の質問 ${q.id} に選択肢がありません`)
  }
  for (const it of def.requiredItems) {
    if (iids.has(it.id) || qids.has(it.id)) errors.push(`必要項目IDが重複しています: ${it.id}`)
    iids.add(it.id)
    for (const q of it.questionIds ?? []) if (!qids.has(q)) errors.push(`必要項目 ${it.id} が存在しない質問 ${q} を参照しています`)
    if (it.type === 'question' && !(it.questionIds?.length)) errors.push(`必要項目 ${it.id} に質問が設定されていません`)
  }
  for (const q of def.questions) if (q.fileItemId && !iids.has(q.fileItemId)) errors.push(`質問 ${q.id} のファイル項目 ${q.fileItemId} が存在しません`)
  for (const r of def.rules) {
    for (const a of r.then) if (!qids.has(a.target) && !iids.has(a.target)) errors.push(`ルール ${r.id} の対象 ${a.target} が存在しません`)
    if ((r.status ?? 'active') === 'draft') warnings.push(`ルール ${r.id} は下書き（AI提案など）のため無効です。確認して有効化してください`)
  }
  const cycles = detectCycles(def)
  for (const c of cycles) errors.push(`条件分岐が循環しています: ${c.join(' → ')}`)
  return { errors, warnings }
}

export function parseDefinition(raw: unknown): TemplateDefinition {
  const r = definitionSchema.safeParse(raw)
  if (!r.success) throw badRequest('テンプレート定義の形式が正しくありません', r.error.issues.slice(0, 20))
  return r.data as TemplateDefinition
}

export async function createTemplate(ctx: Ctx, actor: Actor, input: { workspaceId: string; name: string; description?: string; industry?: string; sampleKey?: string; definition?: unknown }) {
  requirePerm(actor, 'template.edit')
  const ws = await ctx.db.one('SELECT id FROM workspaces WHERE id=$1 AND org_id=$2', [input.workspaceId, actor.orgId])
  if (!ws) throw notFound('ワークスペース')
  const sample = input.sampleKey ? sampleTemplates.find((s) => s.key === input.sampleKey) : undefined
  if (input.sampleKey && !sample) throw badRequest('サンプルが見つかりません')
  const def = input.definition ? parseDefinition(input.definition) : sample ? structuredClone(sample.definition) : blankDefinition()
  const t = await ctx.db.one<{ id: string }>(
    'INSERT INTO templates (org_id, workspace_id, name, description, industry, draft, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
    [actor.orgId, input.workspaceId, input.name, input.description ?? sample?.description ?? '', input.industry ?? sample?.industry ?? 'generic', JSON.stringify(def), actor.userId ?? null],
  )
  await audit(ctx.db, actor, 'template.create', 'template', t!.id, { sample: input.sampleKey ?? null })
  return getTemplate(ctx, actor, t!.id)
}

export function blankDefinition(): TemplateDefinition {
  return {
    sections: [{ id: 's1', title: '基本情報' }],
    questions: [{ id: 'client_name', sectionId: 's1', type: 'short_text', label: 'お名前・会社名', required: true }],
    rules: [], requiredItems: [], completionRules: { ...DEFAULT_COMPLETION_RULES }, reminderPolicy: structuredClone(DEFAULT_REMINDER_POLICY),
    packageTemplate: { profile: 'generic', mapping: {} }, hiddenAnswerPolicy: 'retain_excluded',
  }
}

export async function getTemplate(ctx: Ctx, actor: Actor, templateId: string) {
  requirePerm(actor, 'read')
  const t = await ctx.db.one('SELECT * FROM templates WHERE id=$1 AND org_id=$2', [templateId, actor.orgId])
  if (!t) throw notFound('テンプレート')
  const versions = (await ctx.db.query('SELECT id, version, name, published_at FROM template_versions WHERE template_id=$1 AND org_id=$2 ORDER BY version DESC', [templateId, actor.orgId])).rows
  return { ...t, versions, lint: lintDefinition(t.draft) }
}

export async function listTemplates(ctx: Ctx, actor: Actor) {
  requirePerm(actor, 'read')
  return (await ctx.db.query(
    `SELECT t.id, t.name, t.description, t.industry, t.status, t.workspace_id, t.updated_at, v.version AS current_version
     FROM templates t LEFT JOIN template_versions v ON v.id = t.current_version_id WHERE t.org_id=$1 ORDER BY t.updated_at DESC`, [actor.orgId])).rows
}

export async function updateDraft(ctx: Ctx, actor: Actor, templateId: string, input: { name?: string; description?: string; definition?: unknown }) {
  requirePerm(actor, 'template.edit')
  const t = await ctx.db.one('SELECT id, status FROM templates WHERE id=$1 AND org_id=$2', [templateId, actor.orgId])
  if (!t) throw notFound('テンプレート')
  if (t.status === 'archived') throw badRequest('アーカイブ済みテンプレートは編集できません')
  const def = input.definition !== undefined ? parseDefinition(input.definition) : null
  await ctx.db.query(
    `UPDATE templates SET name=COALESCE($3,name), description=COALESCE($4,description), draft=COALESCE($5::jsonb, draft), updated_at=now() WHERE id=$1 AND org_id=$2`,
    [templateId, actor.orgId, input.name ?? null, input.description ?? null, def ? JSON.stringify(def) : null],
  )
  await audit(ctx.db, actor, 'template.update_draft', 'template', templateId, {})
  return getTemplate(ctx, actor, templateId)
}

export async function publishTemplate(ctx: Ctx, actor: Actor, templateId: string) {
  requirePerm(actor, 'template.publish')
  return ctx.db.tx(async (db) => {
    const t = await db.one('SELECT * FROM templates WHERE id=$1 AND org_id=$2 FOR UPDATE', [templateId, actor.orgId])
    if (!t) throw notFound('テンプレート')
    const def = parseDefinition(t.draft)
    const lint = lintDefinition(def)
    if (lint.errors.length) throw badRequest('テンプレートにエラーがあるため公開できません', lint.errors)
    const last = await db.one<{ v: number }>('SELECT COALESCE(MAX(version),0) AS v FROM template_versions WHERE template_id=$1', [templateId])
    const version = Number(last!.v) + 1
    const v = await db.one<{ id: string }>(
      'INSERT INTO template_versions (org_id, template_id, version, name, definition, published_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [actor.orgId, templateId, version, t.name, JSON.stringify(def), actor.userId ?? null],
    )
    await db.query(`UPDATE templates SET status='published', current_version_id=$2, updated_at=now() WHERE id=$1`, [templateId, v!.id])
    await audit(db, actor, 'template.publish', 'template', templateId, { version, versionId: v!.id })
    return { versionId: v!.id, version }
  })
}

export async function archiveTemplate(ctx: Ctx, actor: Actor, templateId: string) {
  requirePerm(actor, 'template.publish')
  const r = await ctx.db.query(`UPDATE templates SET status='archived', updated_at=now() WHERE id=$1 AND org_id=$2`, [templateId, actor.orgId])
  if (!r.rowCount) throw notFound('テンプレート')
  await audit(ctx.db, actor, 'template.archive', 'template', templateId, {})
}

export async function getVersion(db: Db, orgId: string, versionId: string): Promise<{ id: string; template_id: string; version: number; name: string; definition: TemplateDefinition }> {
  const v = await db.one('SELECT id, template_id, version, name, definition FROM template_versions WHERE id=$1 AND org_id=$2', [versionId, orgId])
  if (!v) throw notFound('テンプレートバージョン')
  return v
}
