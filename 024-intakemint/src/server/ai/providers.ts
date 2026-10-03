// AI provider abstraction. AI output is ALWAYS a *candidate* that a human must accept.
// - LocalHeuristicProvider: deterministic, runs in-process, no external transfer (default).
// - AnthropicProvider: external API; only used when operator opted in (AI_ALLOW_EXTERNAL=true + key) and org/case AI is ON.
import type { Answers, Question, TemplateDefinition } from '../../shared/types'
import { isAnswered } from '../../shared/logic'

export interface SourceRef { questionId?: string; fileId?: string }
export interface FollowUpCandidate { questionId: string; text: string; options?: string[]; reason: string; sourceRefs: SourceRef[] }
export interface ContradictionCandidate { text: string; sourceRefs: SourceRef[]; fingerprint: string }
export interface AmbiguityCandidate { questionId: string; text: string; reason: string; sourceRefs: SourceRef[] }

export interface CaseAnalysisInput {
  def: TemplateDefinition
  /** visible answers only (hidden answers excluded) */
  answers: Answers
  /** text extracted from files that are NOT ai_excluded */
  fileTexts: { fileId: string; name: string; text: string }[]
  today: string
}
export interface CaseAnalysisOutput { followUps: FollowUpCandidate[]; contradictions: ContradictionCandidate[]; ambiguities: AmbiguityCandidate[] }

export interface FileClassifyInput { fileId: string; name: string; mime: string; itemCategory?: string; itemLabel?: string; text?: string }
export interface FileClassifyOutput { category: string; confidence: 'low' | 'medium' | 'high'; basis: string[]; note: string }

export interface AiProvider {
  readonly name: string
  readonly external: boolean
  analyzeCase(input: CaseAnalysisInput): Promise<CaseAnalysisOutput>
  classifyFile(input: FileClassifyInput): Promise<FileClassifyOutput>
}

const VAGUE = [/^会社のサイト(です)?。?$/, /いい感じ/, /おまかせ|お任せ/, /^特に(なし|ない)/, /^未定/, /わから(ない|ん)/, /^普通/, /^適当/, /^なんでも/, /^ホームページ(です)?。?$/, /^サイト(です)?。?$/]

function questionText(q: Question): string { return `${q.label} ${(q.tags ?? []).join(' ')} ${q.id}` }

export class LocalHeuristicProvider implements AiProvider {
  readonly name = 'local-heuristic'
  readonly external = false

  async analyzeCase(input: CaseAnalysisInput): Promise<CaseAnalysisOutput> {
    const { def, answers } = input
    const followUps: FollowUpCandidate[] = []
    const ambiguities: AmbiguityCandidate[] = []
    const contradictions: ContradictionCandidate[] = []

    for (const q of def.questions) {
      const v = answers[q.id]
      if (!isAnswered(v)) continue
      if ((q.type === 'long_text' || q.type === 'short_text') && typeof v === 'string') {
        const s = v.trim()
        const isGoal = /goal|purpose|objective|目的|達成/.test(questionText(q))
        const vague = VAGUE.some((re) => re.test(s)) || (q.type === 'long_text' && s.length < 12)
        if (!vague) continue
        if (isGoal) {
          followUps.push({
            questionId: q.id,
            text: 'サイトの一番の目的を教えてください。（例：問い合わせを増やしたい／採用応募を集めたい／会社案内として信頼感を出したい／商品を販売したい）',
            options: ['問い合わせ獲得', '採用', '会社案内', '販売'],
            reason: `回答「${s.slice(0, 40)}」だけでは主目的が判断できません`,
            sourceRefs: [{ questionId: q.id }],
          })
        } else {
          ambiguities.push({ questionId: q.id, text: `「${q.label}」をもう少し具体的に教えてください。`, reason: `回答が短く/曖昧です（「${s.slice(0, 40)}」）`, sourceRefs: [{ questionId: q.id }] })
        }
      }
      if (q.type === 'repeating_group' && Array.isArray(v) && q.fields?.some((f) => f.id === 'reason')) {
        const noReason = (v as Record<string, unknown>[]).filter((r) => isAnswered(r.url) && !isAnswered(r.reason))
        if (noReason.length) ambiguities.push({ questionId: q.id, text: '参考サイトのどこを参考にしたいか（デザイン・構成・機能など）を教えてください。', reason: `${noReason.length}件の参考サイトに「参考にしたい点」がありません`, sourceRefs: [{ questionId: q.id }] })
      }
    }

    // Numeric contradictions: a count question vs. numbers mentioned in free text with the same unit.
    const countQs = def.questions.filter((q) => q.type === 'number' && /数|count/.test(q.label + q.id) && isAnswered(answers[q.id]))
    for (const cq of countQs) {
      const n = Number(answers[cq.id])
      const unit = /商品/.test(cq.label) ? '(?:商品|品目|アイテム|点)' : /人/.test(cq.label) ? '(?:人|名)' : '(?:件|個|点)'
      const re = new RegExp(`(?:全|計|合計|約)?\\s*([0-9０-９]{1,6})\\s*${unit}`, 'g')
      const texts: { qid?: string; fileId?: string; text: string }[] = [
        ...def.questions.filter((q) => q.id !== cq.id && typeof answers[q.id] === 'string').map((q) => ({ qid: q.id, text: answers[q.id] as string })),
        ...input.fileTexts.map((f) => ({ fileId: f.fileId, text: f.text })),
      ]
      for (const t of texts) {
        for (const m of t.text.matchAll(re)) {
          const k = Number(m[1].replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0)))
          if (Number.isFinite(k) && k !== n && k > 0) {
            contradictions.push({
              text: `「${cq.label}」は${n}ですが、別の回答に「${m[0].trim()}」とあります。どちらが正しいか確認してください。`,
              sourceRefs: [{ questionId: cq.id }, t.qid ? { questionId: t.qid } : { fileId: t.fileId }],
              fingerprint: `num:${cq.id}:${t.qid ?? t.fileId}:${n}:${k}`,
            })
            break
          }
        }
      }
    }
    // yes/no vs free text
    for (const q of def.questions.filter((x) => x.type === 'yes_no' && answers[x.id] === 'no')) {
      const kw = /会員/.test(q.label) ? '会員' : null
      if (!kw) continue
      for (const t of def.questions.filter((x) => typeof answers[x.id] === 'string')) {
        const s = answers[t.id] as string
        if (s.includes(kw) && !/不要|なし|いらない/.test(s)) {
          contradictions.push({ text: `「${q.label}」は「いいえ」ですが、「${t.label}」に「${kw}」に関する記述があります。`, sourceRefs: [{ questionId: q.id }, { questionId: t.id }], fingerprint: `yn:${q.id}:${t.id}` })
          break
        }
      }
    }
    // dates in the past
    for (const q of def.questions.filter((x) => x.type === 'date' && typeof answers[x.id] === 'string')) {
      if ((answers[q.id] as string) < input.today && /公開|納品|開始|希望/.test(q.label)) {
        contradictions.push({ text: `「${q.label}」(${answers[q.id]})が過去の日付です。`, sourceRefs: [{ questionId: q.id }], fingerprint: `date:${q.id}:${answers[q.id]}` })
      }
    }
    return { followUps, contradictions, ambiguities }
  }

  async classifyFile(input: FileClassifyInput): Promise<FileClassifyOutput> {
    const basis: string[] = []
    let category = input.itemCategory ?? 'other'
    if (input.itemCategory) basis.push(`提出先項目「${input.itemLabel ?? ''}」のカテゴリ`)
    const n = input.name.toLowerCase()
    const byName: [RegExp, string][] = [[/logo|ロゴ/, 'brand'], [/invoice|請求|領収|receipt|明細/, 'finance'], [/contract|契約|規約|terms/, 'legal'], [/product|商品|item/, 'product'], [/ref|参考/, 'reference'], [/company|会社|profile|概要/, 'company']]
    const hit = byName.find(([re]) => re.test(n))
    if (hit && !input.itemCategory) { category = hit[1]; basis.push('ファイル名（参考情報のみ）') }
    if (input.mime.startsWith('image/')) basis.push('画像形式')
    // File names alone never determine content: confidence stays low unless content text supports it.
    let confidence: FileClassifyOutput['confidence'] = input.itemCategory ? 'medium' : 'low'
    if (input.text && hit && new RegExp(hit[0].source).test(input.text.toLowerCase())) { confidence = 'medium'; basis.push('本文テキスト') }
    return { category, confidence, basis, note: '分類は候補です。内容は原本ファイルを確認してください。' }
  }
}

/** External provider (Anthropic Messages API). Responses are validated: candidates must reference existing question ids. */
export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic'
  readonly external = true
  constructor(private apiKey: string, private model = 'claude-haiku-4-5-20251001', private fallback = new LocalHeuristicProvider()) {}

  private async call(system: string, user: string): Promise<string> {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: this.model, max_tokens: 2000, system, messages: [{ role: 'user', content: user }] }),
      signal: AbortSignal.timeout(30000),
    })
    if (!r.ok) throw new Error(`anthropic ${r.status}`)
    const j = (await r.json()) as { content: { type: string; text?: string }[] }
    return j.content.map((c) => c.text ?? '').join('')
  }

  async analyzeCase(input: CaseAnalysisInput): Promise<CaseAnalysisOutput> {
    const qs = input.def.questions.map((q) => ({ id: q.id, label: q.label, answer: input.answers[q.id] ?? null }))
    const system = 'You review client intake answers. Output ONLY JSON {"followUps":[{"questionId","text","reason"}],"contradictions":[{"text","questionIds":[]}],"ambiguities":[{"questionId","text","reason"}]}. Never invent requirements; only reference given question ids; write in Japanese.'
    const raw = await this.call(system, JSON.stringify({ questions: qs, files: input.fileTexts.map((f) => ({ id: f.fileId, text: f.text.slice(0, 4000) })) }))
    const ids = new Set(input.def.questions.map((q) => q.id))
    try {
      const j = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1))
      return {
        followUps: (j.followUps ?? []).filter((x: any) => ids.has(x.questionId)).map((x: any) => ({ questionId: x.questionId, text: String(x.text), reason: String(x.reason ?? ''), sourceRefs: [{ questionId: x.questionId }] })),
        ambiguities: (j.ambiguities ?? []).filter((x: any) => ids.has(x.questionId)).map((x: any) => ({ questionId: x.questionId, text: String(x.text), reason: String(x.reason ?? ''), sourceRefs: [{ questionId: x.questionId }] })),
        contradictions: (j.contradictions ?? []).filter((x: any) => Array.isArray(x.questionIds) && x.questionIds.length && x.questionIds.every((i: string) => ids.has(i)))
          .map((x: any) => ({ text: String(x.text), sourceRefs: x.questionIds.map((i: string) => ({ questionId: i })), fingerprint: `ext:${x.questionIds.join(',')}` })),
      }
    } catch { return this.fallback.analyzeCase(input) }
  }

  async classifyFile(input: FileClassifyInput): Promise<FileClassifyOutput> {
    return this.fallback.classifyFile(input) // metadata-only classification; no file bytes leave the server in the foundation
  }
}
