// MCP tool definitions (transport-independent, unit-testable).
// Read tools answer with facts from the deterministic engine. Write tools REQUIRE confirm:true —
// without it they only return a preview of what would happen. No tool sends email or contacts clients directly.
import { z } from 'zod'
import type { Ctx, Actor } from '../server/services/context'
import { caseDetail, createCase, loadState, listCases } from '../server/services/cases'
import { reviewItem, requestMoreInfo } from '../server/services/review'
import { generatePackage, buildPackage, toMarkdown } from '../server/services/packages'
import { draftManualReminder } from '../server/services/reminders'
import { search } from '../server/services/search'
import { requirePerm } from '../server/services/rbac'
import { audit } from '../server/services/audit'
import { STATUS_LABEL, CASE_STATUS_LABEL } from '../shared/completeness'

export interface ToolDef { name: string; description: string; input: z.ZodObject<any>; write: boolean; run: (ctx: Ctx, actor: Actor, args: any) => Promise<unknown> }

const confirm = z.boolean().optional().describe('true の場合のみ実行。省略/false はプレビューのみ（人間の確認を経てから true で再実行）')
const caseId = z.string().uuid().describe('案件ID')

function preview(action: string, details: unknown) {
  return { requiresConfirmation: true, action, details, message: 'これは書き込み操作です。内容をユーザーに確認し、承認された場合のみ confirm:true で再実行してください。' }
}

async function statusFacts(ctx: Ctx, actor: Actor, id: string) {
  requirePerm(actor, 'read')
  const st = await loadState(ctx.db, actor.orgId, id)
  const r = st.result
  return {
    caseId: id, project: st.row.project_name, client: st.row.client_name,
    status: st.row.status, statusLabel: CASE_STATUS_LABEL[st.row.status],
    canStart: st.row.status === 'ready' || st.row.status === 'started',
    progress: { text: `必要項目${r.progress.denominator}件中${r.progress.submitted}件提出・${r.progress.accepted}件承認`, ...r.progress },
    blockingReasons: r.ready.reasons.map((x) => x.message),
    warnings: r.ready.warnings.map((x) => x.message),
    readyOverride: st.row.ready_override ?? null,
    note: 'Ready判定は決定的ルール（必須回答・必須ファイル承認・未解決AI候補・内部サインオフ）に基づきます。',
  }
}

export const TOOLS: ToolDef[] = [
  {
    name: 'get_intake_status', write: false,
    description: '案件の準備状況（開始できるか、進捗の分母/分子、Readyを妨げている理由）を事実で返す。「この案件開始できる？」に使う。',
    input: z.object({ caseId }),
    run: (ctx, a, x) => statusFacts(ctx, a, x.caseId),
  },
  {
    name: 'get_missing_items', write: false,
    description: '未提出・一部提出・差し戻し・確認待ちの必要項目と未回答の追加質問を返す。',
    input: z.object({ caseId }),
    run: async (ctx, a, x) => {
      requirePerm(a, 'read')
      const st = await loadState(ctx.db, a.orgId, x.caseId)
      const fus = (await ctx.db.query(`SELECT id, text, status FROM followups WHERE case_id=$1 AND status IN ('open','answered')`, [x.caseId])).rows
      return {
        missing: st.result.items.filter((i) => i.applicable && i.required && i.status !== 'accepted').map((i) => ({
          itemId: i.itemId, label: i.label, status: i.status, statusLabel: STATUS_LABEL[i.status], ...(i.type === 'file' ? { count: i.count, minCount: i.minCount } : { answered: i.answered, total: i.total }),
        })),
        openFollowups: fus,
      }
    },
  },
  {
    name: 'get_ready_cases', write: false, description: 'Ready（開始可能）の案件一覧。', input: z.object({}),
    run: async (ctx, a) => (await listCases(ctx, a, { status: 'ready' })).map((c) => ({ caseId: c.id, project: c.project_name, client: c.client_name, readyAt: c.ready_at })),
  },
  {
    name: 'search_intakes', write: false, description: '案件・クライアント・回答・ファイル名を権限内で検索。', input: z.object({ query: z.string().min(1).max(100) }),
    run: (ctx, a, x) => search(ctx, a, x.query, { limit: 20 }),
  },
  {
    name: 'prepare_handoff', write: false,
    description: '制作担当/Claude Code向けHandoff（出典付き）をプレビュー生成する（保存しない）。未確定事項はOpen Questionsとして返る。',
    input: z.object({ caseId, profile: z.enum(['web_development', 'design', 'video', 'sns_management', 'consulting', 'recruiting', 'accounting_prep', 'generic']).optional() }),
    run: async (ctx, a, x) => {
      requirePerm(a, 'read')
      const st = await loadState(ctx.db, a.orgId, x.caseId)
      const d = await caseDetail(ctx, a, x.caseId)
      const p = buildPackage(st, ctx.now(), { followups: d.followups, reviews: d.reviews, profile: x.profile })
      return { ready: st.row.status === 'ready', warning: st.row.status === 'ready' ? null : 'この案件はまだReadyではありません。未確定事項を含みます。', markdown: toMarkdown(p) }
    },
  },
  {
    name: 'create_intake', write: true, description: '公開済みテンプレートから新しい案件を作成する（クライアントへの送信はしない）。',
    input: z.object({ templateId: z.string().uuid(), clientName: z.string().min(1).max(200), projectName: z.string().min(1).max(200), clientEmail: z.string().email().optional(), targetReadyDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), confirm }),
    run: async (ctx, a, x) => {
      requirePerm(a, 'case.create')
      if (!x.confirm) return preview('create_intake', { templateId: x.templateId, clientName: x.clientName, projectName: x.projectName })
      return { caseId: await createCase(ctx, a, x) }
    },
  },
  {
    name: 'review_response', write: true, description: '必要項目を承認/差し戻し/要確認にする（差し戻し理由はクライアントに表示される）。',
    input: z.object({ caseId, itemId: z.string().max(80), decision: z.enum(['accept', 'reject', 'needs_review']), note: z.string().max(2000).optional(), confirm }),
    run: async (ctx, a, x) => {
      requirePerm(a, 'review')
      if (!x.confirm) return preview('review_response', { caseId: x.caseId, itemId: x.itemId, decision: x.decision, note: x.note })
      const r = await reviewItem(ctx, a, x.caseId, x.itemId, x.decision, x.note)
      return { ok: true, progress: r.progress }
    },
  },
  {
    name: 'request_more_information', write: true, description: 'クライアントポータルに追加質問を表示する（メールは送らない。リマインドは別途人間が承認）。',
    input: z.object({ caseId, text: z.string().min(1).max(2000), questionId: z.string().max(64).optional(), confirm }),
    run: async (ctx, a, x) => {
      requirePerm(a, 'review')
      if (!x.confirm) return preview('request_more_information', { caseId: x.caseId, text: x.text, visibleToClient: true })
      return { followupId: await requestMoreInfo(ctx, a, x.caseId, x.text, x.questionId) }
    },
  },
  {
    name: 'draft_reminder', write: true, description: '未提出項目だけを含むリマインドの下書きを作る（送信はアプリ上で人間が承認）。',
    input: z.object({ caseId, confirm }),
    run: async (ctx, a, x) => {
      requirePerm(a, 'case.edit')
      if (!x.confirm) return preview('draft_reminder', { caseId: x.caseId, sends: false })
      return { reminderId: await draftManualReminder(ctx, a, x.caseId), status: 'draft' }
    },
  },
  {
    name: 'generate_intake_package', write: true, description: '案件開始パック（JSON/Markdown・出典付き）を生成して保存する。',
    input: z.object({ caseId, profile: z.enum(['web_development', 'design', 'video', 'sns_management', 'consulting', 'recruiting', 'accounting_prep', 'generic']).optional(), confirm }),
    run: async (ctx, a, x) => {
      requirePerm(a, 'package.generate')
      const st = await loadState(ctx.db, a.orgId, x.caseId)
      if (!x.confirm) return preview('generate_intake_package', { caseId: x.caseId, ready: st.row.status === 'ready' })
      const r = await generatePackage(ctx, a, x.caseId, x.profile)
      return { packageId: r.id, version: r.version, ready: st.row.status === 'ready', markdown: r.markdown }
    },
  },
]

export async function callTool(ctx: Ctx, actor: Actor, name: string, args: unknown): Promise<unknown> {
  const t = TOOLS.find((x) => x.name === name)
  if (!t) throw new Error(`unknown tool: ${name}`)
  const parsed = t.input.parse(args ?? {})
  const out = await t.run(ctx, actor, parsed)
  if (t.write && parsed.confirm) await audit(ctx.db, actor, `mcp.${name}`, 'mcp', null, { caseId: parsed.caseId ?? null })
  return out
}
