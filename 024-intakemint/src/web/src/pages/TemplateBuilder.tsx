// Template Builder: sections, questions, conditional logic, required items, reminders, Ready rules, package layout.
import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api, fmtDateTime } from '../api'
import { useAsync, useToast } from '../components/ui'
import { can, useMe } from '../App'
import { detectCycles } from '../../../shared/logic'
import { QUESTION_TYPES, FILE_CATEGORIES, PACKAGE_SECTIONS, type Question, type RequiredItem, type Rule, type TemplateDefinition } from '../../../shared/types'

const QT: Record<string, string> = {
  short_text: '短文', long_text: '長文', email: 'メール', phone: '電話', url: 'URL', number: '数値', date: '日付', single_choice: '単一選択',
  multiple_choice: '複数選択', yes_no: 'はい/いいえ', file: 'ファイル', image: '画像', repeating_group: '繰り返し項目', acknowledgement: '同意チェック',
}
const OPS: [string, string][] = [['eq', '＝'], ['neq', '≠'], ['contains', 'を含む'], ['in', 'のいずれか'], ['gt', '＞'], ['gte', '≧'], ['lt', '＜'], ['lte', '≦'], ['answered', '回答あり'], ['not_answered', '未回答']]
const slug = (p: string) => `${p}_${Math.random().toString(36).slice(2, 7)}`

export default function TemplateBuilder() {
  const { id } = useParams()
  const { me } = useMe()
  const toast = useToast()
  const { data, reload } = useAsync(() => api(`/api/templates/${id}`), [id])
  const [def, setDef] = useState<TemplateDefinition | null>(null)
  const [name, setName] = useState('')
  const [tab, setTab] = useState('questions')
  const [dirty, setDirty] = useState(false)
  const [serverLint, setServerLint] = useState<{ errors: string[]; warnings: string[] } | null>(null)
  const [json, setJson] = useState('')
  useEffect(() => { if (data) { setDef(structuredClone(data.draft)); setName(data.name); setServerLint(data.lint); setDirty(false) } }, [data])
  const cycles = useMemo(() => (def ? detectCycles(def) : []), [def])
  if (!data || !def) return <div className="empty">読み込み中…</div>
  const editable = can(me, 'template.edit') && data.status !== 'archived'
  const upd = (fn: (d: TemplateDefinition) => void) => { const n = structuredClone(def); fn(n); setDef(n); setDirty(true) }
  const save = async () => {
    try { const r = await api(`/api/templates/${id}`, { method: 'PUT', body: { name, definition: def } }); setServerLint(r.lint); setDirty(false); toast('下書きを保存しました') } catch (e: any) { toast(e.message) }
  }
  const publish = async () => {
    if (dirty) await save()
    try { const r = await api(`/api/templates/${id}/publish`, { method: 'POST' }); toast(`v${r.version} を公開しました（既存案件は旧バージョンのまま）`); reload() }
    catch (e: any) { toast(e.message); if (e.details) setServerLint({ errors: e.details, warnings: [] }) }
  }
  const qOpts = def.questions.map((q) => <option key={q.id} value={q.id}>{q.label}（{q.id}）</option>)
  const targets = [...def.questions.map((q) => [q.id, `質問: ${q.label}`]), ...def.requiredItems.map((i) => [i.id, `項目: ${i.label}`])]

  return (
    <div>
      <div className="row between" style={{ marginBottom: 12 }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <input className="input" style={{ fontSize: 20, fontWeight: 700, maxWidth: 520 }} value={name} disabled={!editable} onChange={(e) => { setName(e.target.value); setDirty(true) }} aria-label="フォーム名" />
          <div className="small muted" style={{ marginTop: 4 }}>状態：{data.status} ・ 公開バージョン：{data.versions.map((v: any) => `v${v.version}`).join(', ') || 'なし'}</div>
        </div>
        {editable && <div className="row"><button className="btn" onClick={save} disabled={!dirty}>下書き保存</button>{can(me, 'template.publish') && <button className="btn btn-primary" onClick={publish} disabled={cycles.length > 0}>公開（新バージョン）</button>}</div>}
      </div>
      {cycles.length > 0 && <div className="alert alert-danger" style={{ marginBottom: 10 }}>条件分岐が循環しています：{cycles.map((c) => c.join(' → ')).join(' / ')}（公開できません）</div>}
      {serverLint?.errors.length ? <div className="alert alert-danger small" style={{ marginBottom: 10 }}><ul style={{ margin: 0, paddingLeft: 18 }}>{serverLint.errors.map((e, i) => <li key={i}>{e}</li>)}</ul></div> : null}
      {serverLint?.warnings.length ? <div className="alert alert-warn small" style={{ marginBottom: 10 }}>{serverLint.warnings.join(' / ')}</div> : null}

      <div className="tabs">
        {[['questions', 'セクション・質問'], ['logic', '条件分岐'], ['items', '必要項目'], ['ready', 'Ready条件'], ['reminder', 'リマインド'], ['package', 'パック構成'], ['json', 'JSON']].map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => { setTab(k); if (k === 'json') setJson(JSON.stringify(def, null, 2)) }}>{l}</button>)}
      </div>

      {tab === 'questions' && (
        <div>
          {def.sections.map((s, si) => (
            <section key={s.id} className="card">
              <div className="row between">
                <input className="input" style={{ fontWeight: 700, maxWidth: 420 }} value={s.title} disabled={!editable} onChange={(e) => upd((d) => { d.sections[si].title = e.target.value })} aria-label="セクション名" />
                {editable && <button className="btn btn-sm btn-ghost" onClick={() => upd((d) => { d.sections.splice(si, 1); d.questions = d.questions.filter((q) => q.sectionId !== s.id) })}>セクション削除</button>}
              </div>
              <div className="stack" style={{ marginTop: 10 }}>
                {def.questions.map((q, qi) => q.sectionId !== s.id ? null : (
                  <QuestionEditor key={q.id} q={q} def={def} disabled={!editable} onChange={(nq) => upd((d) => { d.questions[qi] = nq })} onDelete={() => upd((d) => { d.questions.splice(qi, 1) })} />
                ))}
              </div>
              {editable && <button className="btn btn-sm" style={{ marginTop: 10 }} onClick={() => upd((d) => { d.questions.push({ id: slug('q'), sectionId: s.id, type: 'short_text', label: '新しい質問' }) })}>＋ 質問を追加</button>}
            </section>
          ))}
          {editable && <button className="btn" style={{ marginTop: 12 }} onClick={() => upd((d) => { d.sections.push({ id: slug('s'), title: '新しいセクション' }) })}>＋ セクションを追加</button>}
        </div>
      )}

      {tab === 'logic' && (
        <section className="card">
          <p className="small muted" style={{ marginTop: 0 }}>回答に応じて質問・必要項目を表示/非表示/必須化します。非表示の質問の回答は保持されますが、進捗・Ready・パックからは除外されます。AIが提案したルールは「下書き」で、有効化するまで動作しません。</p>
          {def.rules.map((r, ri) => (
            <RuleEditor key={r.id} r={r} qOpts={qOpts} targets={targets} disabled={!editable} onChange={(nr) => upd((d) => { d.rules[ri] = nr })} onDelete={() => upd((d) => { d.rules.splice(ri, 1) })} questions={def.questions} />
          ))}
          {editable && <button className="btn btn-sm" onClick={() => upd((d) => { d.rules.push({ id: slug('r'), when: { questionId: d.questions[0]?.id ?? '', op: 'answered' }, then: [{ type: 'show', target: d.questions[0]?.id ?? '' }], status: 'active', origin: 'human' }) })}>＋ ルールを追加</button>}
        </section>
      )}

      {tab === 'items' && (
        <section className="card">
          <p className="small muted" style={{ marginTop: 0 }}>「必要項目」が進捗の分母になります（例：必要項目7件中5件）。必須の質問で項目に含まれないものは自動で1項目として数えます。</p>
          {def.requiredItems.map((it, ii) => (
            <ItemEditor key={it.id} it={it} qOpts={qOpts} questions={def.questions} disabled={!editable} onChange={(ni) => upd((d) => { d.requiredItems[ii] = ni })} onDelete={() => upd((d) => { d.requiredItems.splice(ii, 1) })} />
          ))}
          {editable && <div className="row">
            <button className="btn btn-sm" onClick={() => upd((d) => { d.requiredItems.push({ id: slug('item'), label: '新しい項目', type: 'question', required: true, questionIds: [] }) })}>＋ 質問の項目</button>
            <button className="btn btn-sm" onClick={() => upd((d) => { d.requiredItems.push({ id: slug('files'), label: '新しいファイル', type: 'file', required: true, minCount: 1, acceptedFormats: ['pdf', 'png', 'jpg'], maxSizeMB: 20, requireReview: true, category: 'other' }) })}>＋ ファイルの項目</button>
          </div>}
        </section>
      )}

      {tab === 'ready' && (
        <section className="card stack">
          <p className="small muted" style={{ margin: 0 }}>Ready判定は決定的なルールで行います。AIだけでReadyになることはありません。</p>
          <label className="check"><input type="checkbox" checked={def.completionRules.requireInternalSignoff} disabled={!editable} onChange={(e) => upd((d) => { d.completionRules.requireInternalSignoff = e.target.checked })} /><span>内部担当者の最終確認（サインオフ）を必須にする</span></label>
          <label className="check"><input type="checkbox" checked={def.completionRules.requireFileReview} disabled={!editable} onChange={(e) => upd((d) => { d.completionRules.requireFileReview = e.target.checked })} /><span>ファイルはアップロードだけでは承認にしない（担当者の承認が必要）</span></label>
          <label className="check"><input type="checkbox" checked={def.completionRules.autoAcceptAnswers} disabled={!editable} onChange={(e) => upd((d) => { d.completionRules.autoAcceptAnswers = e.target.checked })} /><span>形式が正しい回答は自動で承認する（項目ごとに「要レビュー」を指定可能）</span></label>
          <label className="field"><span>未解決のAI確認候補の扱い</span>
            <select className="input" style={{ maxWidth: 340 }} value={def.completionRules.aiUnresolvedPolicy} disabled={!editable} onChange={(e) => upd((d) => { d.completionRules.aiUnresolvedPolicy = e.target.value as any })}>
              <option value="block">Readyを止める（推奨）</option><option value="warn">警告のみ</option><option value="ignore">考慮しない</option>
            </select></label>
        </section>
      )}

      {tab === 'reminder' && (
        <section className="card stack">
          <label className="check"><input type="checkbox" checked={def.reminderPolicy.enabled} disabled={!editable} onChange={(e) => upd((d) => { d.reminderPolicy.enabled = e.target.checked })} /><span>目標日に合わせてリマインドを作成する</span></label>
          <label className="field"><span>送信方法</span>
            <select className="input" style={{ maxWidth: 360 }} value={def.reminderPolicy.mode} disabled={!editable} onChange={(e) => upd((d) => { d.reminderPolicy.mode = e.target.value as any })}>
              <option value="draft">下書きを作成し、担当者が承認して送信（推奨）</option><option value="auto">自動送信</option>
            </select></label>
          <div className="grid grid-3">
            <label className="field"><span>期限の何日前（カンマ区切り）</span><input className="input" disabled={!editable} value={def.reminderPolicy.daysBefore.join(',')} onChange={(e) => upd((d) => { d.reminderPolicy.daysBefore = e.target.value.split(',').map((x) => Number(x.trim())).filter((n) => n > 0) })} /></label>
            <label className="field"><span>期限超過後 何日ごと</span><input className="input" type="number" min={1} disabled={!editable} value={def.reminderPolicy.overdueEveryDays} onChange={(e) => upd((d) => { d.reminderPolicy.overdueEveryDays = Math.max(1, Number(e.target.value)) })} /></label>
            <label className="field"><span>超過後の最大回数</span><input className="input" type="number" min={0} disabled={!editable} value={def.reminderPolicy.maxOverdue} onChange={(e) => upd((d) => { d.reminderPolicy.maxOverdue = Math.max(0, Number(e.target.value)) })} /></label>
          </div>
          <label className="check"><input type="checkbox" checked={def.reminderPolicy.onDueDate} disabled={!editable} onChange={(e) => upd((d) => { d.reminderPolicy.onDueDate = e.target.checked })} /><span>期限当日にも作成する</span></label>
          <div className="row"><label className="field"><span>送信しない時間帯（開始）</span><input className="input" type="time" disabled={!editable} value={def.reminderPolicy.quietHours.start} onChange={(e) => upd((d) => { d.reminderPolicy.quietHours.start = e.target.value })} /></label>
            <label className="field"><span>（終了）</span><input className="input" type="time" disabled={!editable} value={def.reminderPolicy.quietHours.end} onChange={(e) => upd((d) => { d.reminderPolicy.quietHours.end = e.target.value })} /></label></div>
          <p className="tiny muted">リマインドには未提出の項目だけが入ります。同じ段階のリマインドは重複作成されません。</p>
        </section>
      )}

      {tab === 'package' && (
        <section className="card stack">
          <label className="field"><span>Handoffプロファイル</span>
            <select className="input" style={{ maxWidth: 340 }} value={def.packageTemplate.profile} disabled={!editable} onChange={(e) => upd((d) => { d.packageTemplate.profile = e.target.value as any })}>
              {['web_development', 'design', 'video', 'sns_management', 'consulting', 'recruiting', 'accounting_prep', 'generic'].map((p) => <option key={p}>{p}</option>)}
            </select></label>
          <p className="small muted" style={{ margin: 0 }}>パックの各セクションに入れる質問を選びます（未割当の回答は「Notes」に入ります。回答にない要件は作りません）。</p>
          <div className="table-wrap"><table className="table"><thead><tr><th>セクション</th><th>質問</th></tr></thead><tbody>
            {PACKAGE_SECTIONS.filter((k) => !['openQuestions', 'files', 'decisions', 'assets'].includes(k)).map((k) => (
              <tr key={k}><td>{k}</td><td>
                <select multiple className="input" style={{ minHeight: 90 }} disabled={!editable} value={def.packageTemplate.mapping[k] ?? []} onChange={(e) => { const vals = Array.from(e.target.selectedOptions).map((o) => o.value); upd((d) => { d.packageTemplate.mapping[k] = vals }) }} aria-label={k}>{qOpts}</select>
              </td></tr>
            ))}
          </tbody></table></div>
        </section>
      )}

      {tab === 'json' && (
        <section className="card stack">
          <p className="small muted" style={{ margin: 0 }}>上級者向け：定義をJSONで編集できます。保存時にサーバーで検証されます。</p>
          <textarea className="input mono" style={{ minHeight: 420 }} value={json} onChange={(e) => setJson(e.target.value)} disabled={!editable} aria-label="JSON" />
          {editable && <button className="btn" onClick={() => { try { setDef(JSON.parse(json)); setDirty(true); toast('反映しました（保存してください）') } catch { toast('JSONの形式が正しくありません') } }}>JSONを反映</button>}
        </section>
      )}
      <p className="tiny muted">最終更新 {fmtDateTime(data.updated_at)}</p>
    </div>
  )
}

function QuestionEditor({ q, def, disabled, onChange, onDelete }: { q: Question; def: TemplateDefinition; disabled: boolean; onChange: (q: Question) => void; onDelete: () => void }) {
  const set = (patch: Partial<Question>) => onChange({ ...q, ...patch })
  const fileItems = def.requiredItems.filter((i) => i.type === 'file')
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 12 }}>
      <div className="grid grid-3">
        <label className="field" style={{ gridColumn: 'span 2' }}><span className="small">質問文</span><input className="input" value={q.label} disabled={disabled} onChange={(e) => set({ label: e.target.value })} /></label>
        <label className="field"><span className="small">種類</span><select className="input" value={q.type} disabled={disabled} onChange={(e) => set({ type: e.target.value as any })}>{QUESTION_TYPES.map((t) => <option key={t} value={t}>{QT[t]}</option>)}</select></label>
      </div>
      <div className="row small" style={{ marginTop: 6 }}>
        <span className="mono muted">{q.id}</span>
        <label className="check" style={{ padding: 0 }}><input type="checkbox" checked={!!q.required} disabled={disabled} onChange={(e) => set({ required: e.target.checked })} />必須</label>
        <label className="check" style={{ padding: 0 }}><input type="checkbox" checked={q.visibleByDefault === false} disabled={disabled} onChange={(e) => set({ visibleByDefault: e.target.checked ? false : undefined })} />初期状態は非表示（条件で表示）</label>
        {!disabled && <button className="btn btn-sm btn-ghost" onClick={onDelete}>削除</button>}
      </div>
      <label className="field" style={{ marginTop: 6 }}><span className="small">補足説明</span><input className="input" value={q.help ?? ''} disabled={disabled} onChange={(e) => set({ help: e.target.value || undefined })} /></label>
      {(q.type === 'single_choice' || q.type === 'multiple_choice') && (
        <label className="field" style={{ marginTop: 6 }}><span className="small">選択肢（1行に「値=表示名」）</span>
          <textarea className="input mono" disabled={disabled} value={(q.options ?? []).map((o) => `${o.value}=${o.label}`).join('\n')} onChange={(e) => set({ options: e.target.value.split('\n').filter(Boolean).map((l) => { const [v, ...rest] = l.split('='); return { value: v.trim(), label: (rest.join('=') || v).trim() } }) })} /></label>
      )}
      {q.type === 'number' && <div className="row" style={{ marginTop: 6 }}><input className="input" style={{ maxWidth: 140 }} type="number" placeholder="最小" disabled={disabled} value={q.min ?? ''} onChange={(e) => set({ min: e.target.value === '' ? undefined : Number(e.target.value) })} aria-label="最小" /><input className="input" style={{ maxWidth: 140 }} type="number" placeholder="最大" disabled={disabled} value={q.max ?? ''} onChange={(e) => set({ max: e.target.value === '' ? undefined : Number(e.target.value) })} aria-label="最大" /></div>}
      {(q.type === 'file' || q.type === 'image') && (
        <label className="field" style={{ marginTop: 6 }}><span className="small">提出先のファイル項目</span>
          <select className="input" disabled={disabled} value={q.fileItemId ?? ''} onChange={(e) => set({ fileItemId: e.target.value || undefined })}><option value="">（選択）</option>{fileItems.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}</select></label>
      )}
      {q.type === 'repeating_group' && (
        <label className="field" style={{ marginTop: 6 }}><span className="small">項目（1行に「id=表示名:種類」 種類: short_text/url/email/number）</span>
          <textarea className="input mono" disabled={disabled} value={(q.fields ?? []).map((f) => `${f.id}=${f.label}:${f.type}`).join('\n')} onChange={(e) => set({ fields: e.target.value.split('\n').filter(Boolean).map((l) => { const [idp, rest = ''] = l.split('='); const [label, type = 'short_text'] = rest.split(':'); return { id: idp.trim(), label: (label || idp).trim(), type: type.trim() as any } }) })} /></label>
      )}
    </div>
  )
}

function RuleEditor({ r, qOpts, targets, questions, disabled, onChange, onDelete }: { r: Rule; qOpts: React.ReactNode; targets: string[][]; questions: Question[]; disabled: boolean; onChange: (r: Rule) => void; onDelete: () => void }) {
  const leaf = 'questionId' in r.when ? r.when : null
  const q = questions.find((x) => x.id === leaf?.questionId)
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 12, marginBottom: 10, opacity: r.status === 'draft' ? 0.7 : 1 }}>
      {r.status === 'draft' && <div className="alert alert-warn small" style={{ marginBottom: 8 }}>下書きルール（{r.origin === 'ai' ? 'AI提案' : '無効'}）— 確認して有効化してください {!disabled && <button className="btn btn-sm" onClick={() => onChange({ ...r, status: 'active' })}>有効化</button>}</div>}
      {leaf ? (
        <div className="row">
          <b className="small">もし</b>
          <select className="input" style={{ maxWidth: 260 }} disabled={disabled} value={leaf.questionId} onChange={(e) => onChange({ ...r, when: { ...leaf, questionId: e.target.value } })} aria-label="条件の質問">{qOpts}</select>
          <select className="input" style={{ maxWidth: 130 }} disabled={disabled} value={leaf.op} onChange={(e) => onChange({ ...r, when: { ...leaf, op: e.target.value as any } })} aria-label="比較">{OPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          {!['answered', 'not_answered'].includes(leaf.op) && (q?.options?.length ? (
            <select className="input" style={{ maxWidth: 200 }} disabled={disabled} value={String(leaf.value ?? '')} onChange={(e) => onChange({ ...r, when: { ...leaf, value: e.target.value } })} aria-label="値">{q.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
          ) : q?.type === 'yes_no' ? (
            <select className="input" style={{ maxWidth: 140 }} disabled={disabled} value={String(leaf.value ?? '')} onChange={(e) => onChange({ ...r, when: { ...leaf, value: e.target.value } })} aria-label="値"><option value="yes">はい</option><option value="no">いいえ</option></select>
          ) : <input className="input" style={{ maxWidth: 160 }} disabled={disabled} value={String(leaf.value ?? '')} onChange={(e) => onChange({ ...r, when: { ...leaf, value: q?.type === 'number' ? Number(e.target.value) : e.target.value } })} aria-label="値" />)}
        </div>
      ) : <div className="small mono">複合条件: {JSON.stringify(r.when)}（JSONタブで編集）</div>}
      {r.then.map((a, ai) => (
        <div key={ai} className="row" style={{ marginTop: 6 }}>
          <b className="small">→</b>
          <select className="input" style={{ maxWidth: 140 }} disabled={disabled} value={a.type} onChange={(e) => onChange({ ...r, then: r.then.map((x, j) => (j === ai ? { ...x, type: e.target.value as any } : x)) })} aria-label="アクション"><option value="show">表示</option><option value="hide">非表示</option><option value="require">必須にする</option><option value="unrequire">任意にする</option></select>
          <select className="input" style={{ maxWidth: 300 }} disabled={disabled} value={a.target} onChange={(e) => onChange({ ...r, then: r.then.map((x, j) => (j === ai ? { ...x, target: e.target.value } : x)) })} aria-label="対象">{targets.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          {!disabled && r.then.length > 1 && <button className="btn btn-sm btn-ghost" onClick={() => onChange({ ...r, then: r.then.filter((_, j) => j !== ai) })}>×</button>}
        </div>
      ))}
      {!disabled && <div className="row" style={{ marginTop: 6 }}><button className="btn btn-sm" onClick={() => onChange({ ...r, then: [...r.then, { type: 'show', target: targets[0]?.[0] ?? '' }] })}>＋ アクション</button><button className="btn btn-sm btn-ghost" onClick={onDelete}>ルール削除</button></div>}
    </div>
  )
}

function ItemEditor({ it, qOpts, questions, disabled, onChange, onDelete }: { it: RequiredItem; qOpts: React.ReactNode; questions: Question[]; disabled: boolean; onChange: (i: RequiredItem) => void; onDelete: () => void }) {
  const set = (p: Partial<RequiredItem>) => onChange({ ...it, ...p })
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 12, marginBottom: 10 }}>
      <div className="row">
        <input className="input" style={{ maxWidth: 300, fontWeight: 600 }} value={it.label} disabled={disabled} onChange={(e) => set({ label: e.target.value })} aria-label="項目名" />
        <span className="badge b-draft">{it.type === 'file' ? 'ファイル' : '質問'}</span>
        <span className="mono tiny muted">{it.id}</span>
        <label className="check" style={{ padding: 0 }}><input type="checkbox" checked={it.required} disabled={disabled} onChange={(e) => set({ required: e.target.checked })} />必須</label>
        <label className="check" style={{ padding: 0 }}><input type="checkbox" checked={!!it.requireReview} disabled={disabled} onChange={(e) => set({ requireReview: e.target.checked })} />要レビュー</label>
        {!disabled && <button className="btn btn-sm btn-ghost" onClick={onDelete}>削除</button>}
      </div>
      {it.type === 'question' ? (
        <label className="field" style={{ marginTop: 8 }}><span className="small">この項目を満たす質問（すべて回答で提出済み）</span>
          <select multiple className="input" style={{ minHeight: 90 }} disabled={disabled} value={it.questionIds ?? []} onChange={(e) => set({ questionIds: Array.from(e.target.selectedOptions).map((o) => o.value) })}>{qOpts}</select>
          <span className="help">{(it.questionIds ?? []).map((id) => questions.find((q) => q.id === id)?.label ?? id).join('、')}</span></label>
      ) : (
        <div className="grid grid-3" style={{ marginTop: 8 }}>
          <label className="field"><span className="small">必要数（最小）</span><input className="input" type="number" min={1} disabled={disabled} value={it.minCount ?? 1} onChange={(e) => set({ minCount: Math.max(1, Number(e.target.value)) })} /></label>
          <label className="field"><span className="small">受付形式（拡張子, 区切り）</span><input className="input" disabled={disabled} value={(it.acceptedFormats ?? []).join(',')} onChange={(e) => set({ acceptedFormats: e.target.value.split(',').map((x) => x.trim().toLowerCase().replace(/^\./, '')).filter(Boolean) })} /></label>
          <label className="field"><span className="small">最大サイズ(MB)</span><input className="input" type="number" min={1} disabled={disabled} value={it.maxSizeMB ?? 20} onChange={(e) => set({ maxSizeMB: Number(e.target.value) })} /></label>
          <label className="field"><span className="small">分類</span><select className="input" disabled={disabled} value={it.category ?? 'other'} onChange={(e) => set({ category: e.target.value as any })}>{FILE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></label>
          <label className="field" style={{ gridColumn: 'span 2' }}><span className="small">クライアントへの補足</span><input className="input" disabled={disabled} value={it.notes ?? ''} onChange={(e) => set({ notes: e.target.value || undefined })} /></label>
        </div>
      )}
    </div>
  )
}
