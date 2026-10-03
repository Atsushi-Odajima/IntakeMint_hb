import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api, fmtDate, fmtDateTime, fmtSize } from '../api'
import { CaseBadge, ItemBadge, Modal, Progress, StatusDot, useAsync, useToast } from '../components/ui'
import { can, useMe } from '../App'
import type { Question } from '../../../shared/types'

const KIND: Record<string, string> = { follow_up: '追加質問候補', ambiguous: '曖昧な回答', missing: '不足候補', contradiction: '矛盾候補', classification: '分類候補', extraction: '抽出候補' }
const PROFILES: [string, string][] = [['web_development', 'Web Development（Claude Code向け）'], ['design', 'Design'], ['video', 'Video'], ['sns_management', 'SNS Management'], ['consulting', 'Consulting'], ['recruiting', 'Recruiting'], ['accounting_prep', 'Accounting Prep'], ['generic', 'Generic']]

function answerText(q: Question, v: unknown): string {
  if (v === undefined || v === null || v === '') return '—'
  if (Array.isArray(v)) {
    if (q.type === 'repeating_group') return v.map((r: any) => (q.fields ?? []).map((f) => r[f.id]).filter(Boolean).join(' / ')).join('\n')
    return v.map((x) => q.options?.find((o) => o.value === x)?.label ?? x).join('、')
  }
  if (q.type === 'single_choice') return q.options?.find((o) => o.value === v)?.label ?? String(v)
  if (q.type === 'yes_no') return v === 'yes' ? 'はい' : 'いいえ'
  if (q.type === 'acknowledgement') return v === true ? '確認済み' : '—'
  return String(v)
}

export default function CaseDetail() {
  const { id } = useParams()
  const { me } = useMe()
  const nav = useNavigate()
  const toast = useToast()
  const { data: d, error, reload } = useAsync(() => api(`/api/cases/${id}`), [id])
  const [tab, setTab] = useState('items')
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null)
  const [prompt, setPrompt] = useState<null | { title: string; label: string; required?: boolean; initial?: string; onOk: (v: string) => Promise<void> }>(null)
  const [pkg, setPkg] = useState<{ id: string; markdown: string } | null>(null)
  const [profile, setProfile] = useState('')
  const [linkDays, setLinkDays] = useState(14)
  if (error) return <div className="alert alert-danger">{error}</div>
  if (!d) return <div className="empty">読み込み中…</div>
  const c = d.case, comp = d.completeness, def = d.definition
  const run = async (fn: () => Promise<unknown>, msg?: string) => {
    try { await fn(); if (msg) toast(msg); reload() } catch (e: any) { toast(e.message) }
  }
  const ask = (title: string, label: string, onOk: (v: string) => Promise<void>, required = true, initial = '') => setPrompt({ title, label, onOk, required, initial })
  const openFile = async (fid: string) => {
    const r = await api<{ url: string }>(`/api/files/${fid}/url?inline=1`)
    window.open(r.url, '_blank', 'noopener')
  }
  const visible = comp.logic.visible as Record<string, boolean>
  const filesFor = (itemId: string) => d.files.filter((f: any) => f.itemId === itemId)
  const openCands = d.candidates.filter((x: any) => x.status === 'open')
  const openFollowups = d.followups.filter((x: any) => x.status === 'open' || x.status === 'answered')
  const canReview = can(me, 'review')

  return (
    <div>
      <div className="row between" style={{ alignItems: 'flex-start', marginBottom: 14 }}>
        <div>
          <div className="small muted">{c.client_name}</div>
          <h1 style={{ margin: '2px 0 6px' }}>{c.project_name}</h1>
          <div className="row small"><CaseBadge status={c.status} /><span className="muted">目標日 {fmtDate(c.target_ready_date)}</span><span className="muted">フォーム：{d.template.name} v{d.template.version}</span>{!c.ai_enabled && <span className="badge b-draft">AI OFF</span>}</div>
        </div>
        <div className="row no-print">
          {can(me, 'link.manage') && <button className="btn btn-primary" onClick={() => run(async () => { const r = await api(`/api/cases/${id}/links`, { body: {} }); setLink(r) }, '共有リンクを発行しました')}>共有リンクを発行</button>}
        </div>
      </div>

      {link && (
        <div className="alert alert-ok" style={{ marginBottom: 14 }} role="status">
          <div style={{ fontWeight: 650 }}>クライアント用リンク（この画面でのみ表示されます／{fmtDate(link.expiresAt)}まで有効）</div>
          <div className="row" style={{ marginTop: 6 }}>
            <input className="input mono" readOnly value={link.url} onFocus={(e) => e.target.select()} aria-label="共有リンク" style={{ flex: 1, minWidth: 200 }} />
            <button className="btn btn-sm" onClick={() => { navigator.clipboard?.writeText(link.url); toast('コピーしました') }}>コピー</button>
          </div>
          <div className="tiny" style={{ marginTop: 4 }}>※ IntakeMintはこのリンクを自動でメール送信しません。内容を確認のうえ、お客様へお送りください。</div>
        </div>
      )}

      <div className="grid grid-2" style={{ marginBottom: 16 }}>
        <section className="card" aria-label="進捗">
          <div className="card-title"><h2 style={{ margin: 0 }}>準備率 {comp.progress.percent}%</h2><span className="small muted">必要項目 {comp.progress.denominator}件中 {comp.progress.submitted}件提出・{comp.progress.accepted}件承認</span></div>
          <Progress value={comp.progress.percent} lg />
          <div className="small muted" style={{ marginTop: 6 }}>承認率 {comp.progress.acceptedPercent}%（対象外 {comp.progress.notApplicable}件は分母に含みません）</div>
          {c.missing_summary && <div className="small" style={{ marginTop: 8 }}>次に必要なもの：<b>{c.missing_summary}</b></div>}
        </section>
        <section className="card" aria-label="Ready判定">
          <div className="card-title"><h2 style={{ margin: 0 }}>Ready判定</h2>{c.status === 'ready' ? <span className="badge b-ready">開始できます</span> : <span className="badge b-needs_client">未達</span>}</div>
          {c.ready_override && <div className="alert alert-warn small" style={{ marginBottom: 8 }}>Ready上書き：{c.ready_override.reason}（{c.ready_override.actorName}・{fmtDateTime(c.ready_override.at)}）</div>}
          {comp.ready.reasons.length ? (
            <ul className="small" style={{ margin: '0 0 10px', paddingLeft: 18 }}>{comp.ready.reasons.map((r: any, i: number) => <li key={i}>{r.message}</li>)}</ul>
          ) : <div className="alert alert-ok small">すべての条件を満たしています</div>}
          {comp.ready.warnings.map((w: any, i: number) => <div key={i} className="alert alert-warn small">{w.message}</div>)}
          <div className="row" style={{ marginTop: 8 }}>
            {can(me, 'ready.signoff') && c.status !== 'ready' && c.status !== 'started' && (
              <button className="btn btn-primary btn-sm" disabled={!comp.ready.reasons.every((r: any) => r.code === 'SIGNOFF_REQUIRED')} onClick={() => run(() => api(`/api/cases/${id}/signoff`, { body: {} }), 'サインオフしました')}>内部確認OK（サインオフ）</button>
            )}
            {can(me, 'ready.override') && c.status !== 'ready' && c.status !== 'started' && comp.ready.reasons.length > 0 && (
              <button className="btn btn-sm" onClick={() => ask('Readyを上書き', '理由（必須・監査ログに記録されます）', (v) => api(`/api/cases/${id}/override`, { body: { reason: v } }).then(() => { toast('Readyに上書きしました'); reload() }))}>理由を記録してReadyにする</button>
            )}
            {c.status === 'ready' && can(me, 'case.edit') && <button className="btn btn-mint btn-sm" onClick={() => run(() => api(`/api/cases/${id}/start`, { method: 'POST' }), '開始済みにしました')}>仕事を開始（開始済みにする）</button>}
          </div>
        </section>
      </div>

      <div className="tabs" role="tablist">
        {[['items', '必要項目'], ['answers', '回答'], ['ai', `AI確認${openCands.length + openFollowups.length ? `（${openCands.length + openFollowups.length}）` : ''}`], ['reminders', 'リマインド'], ['links', '共有リンク'], ['package', '案件開始パック'], ['history', '履歴'], ['settings', '設定']].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === 'items' && (
        <section className="card">
          {comp.items.filter((i: any) => i.required || i.applicable).map((i: any) => (
            <div key={i.itemId} className="item-row">
              <StatusDot status={i.status} />
              <div style={{ minWidth: 0 }}>
                <div className="row"><b>{i.label}</b><ItemBadge status={i.status} />{i.type === 'file' && <span className="small muted">{i.count}/{i.minCount}件（承認 {i.acceptedCount}）</span>}{i.type === 'question' && i.applicable && <span className="small muted">{i.answered}/{i.total}問</span>}{!i.required && <span className="tiny muted">任意</span>}</div>
                {i.note && <div className="small muted">メモ：{i.note}</div>}
                {i.missingQuestionIds?.length > 0 && <div className="small muted">未回答：{i.missingQuestionIds.map((q: string) => def.questions.find((x: any) => x.id === q)?.label ?? q).join('、')}</div>}
                {i.type === 'file' && filesFor(i.itemId).length > 0 && (
                  <div className="thumbs">
                    {filesFor(i.itemId).map((f: any) => (
                      <span key={f.id} className="file-pill">
                        <button className="btn btn-ghost btn-sm" style={{ padding: 0, minHeight: 0 }} onClick={() => openFile(f.id)}><span className="name">{f.originalName}</span></button>
                        <span className="tiny muted">{fmtSize(f.size)}</span>
                        <ItemBadge status={f.status === 'pending_review' ? 'submitted' : f.status} />
                        {f.classification && <span className="tiny muted" title={(f.classification.basis ?? []).join(' / ')}>分類候補:{f.classification.category}</span>}
                        {f.ai_excluded && <span className="tiny badge b-draft">AI対象外</span>}
                        {canReview && f.status !== 'accepted' && <button className="btn btn-sm" onClick={() => run(() => api(`/api/files/${f.id}/review`, { body: { decision: 'accept' } }), '承認しました')}>承認</button>}
                        {canReview && f.status !== 'rejected' && <button className="btn btn-sm btn-danger" onClick={() => ask('ファイルを差し戻す', '理由（クライアントに表示されます）', (v) => api(`/api/files/${f.id}/review`, { body: { decision: 'reject', note: v } }).then(() => { toast('差し戻しました'); reload() }))}>差戻</button>}
                        {can(me, 'case.edit') && <button className="btn btn-ghost btn-sm" title="AI処理の対象外にする/戻す" onClick={() => run(() => api(`/api/files/${f.id}/ai-exclusion`, { body: { excluded: !f.ai_excluded } }), f.ai_excluded ? 'AI対象に戻しました' : 'AI対象外にしました')}>{f.ai_excluded ? 'AI可' : 'AI除外'}</button>}
                        {f.review_note && <span className="tiny" style={{ color: 'var(--danger)' }}>{f.review_note}</span>}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              {canReview && i.applicable && (
                <div className="row" style={{ justifyContent: 'flex-end' }}>
                  {i.status !== 'accepted' && i.status !== 'missing' && i.status !== 'partial' && <button className="btn btn-sm" onClick={() => run(() => api(`/api/cases/${id}/items/${encodeURIComponent(i.itemId)}/review`, { body: { decision: 'accept' } }), '承認しました')}>承認</button>}
                  {i.status !== 'rejected' && i.status !== 'missing' && <button className="btn btn-sm btn-danger" onClick={() => ask(`「${i.label}」を差し戻す`, '理由（クライアントに表示されます）', (v) => api(`/api/cases/${id}/items/${encodeURIComponent(i.itemId)}/review`, { body: { decision: 'reject', note: v } }).then(() => { toast('差し戻しました'); reload() }))}>差戻</button>}
                  <button className="btn btn-sm btn-ghost" onClick={() => ask(`「${i.label}」を対象外にする`, '理由', (v) => api(`/api/cases/${id}/items/${encodeURIComponent(i.itemId)}/review`, { body: { decision: 'not_applicable', note: v } }).then(() => { toast('対象外にしました'); reload() }))}>対象外</button>
                </div>
              )}
              {canReview && !i.applicable && d.itemStates.find((s: any) => s.itemId === i.itemId)?.reviewStatus === 'not_applicable' && (
                <button className="btn btn-sm" onClick={() => run(() => api(`/api/cases/${id}/items/${encodeURIComponent(i.itemId)}/review`, { body: { decision: 'reopen' } }), '対象に戻しました')}>対象に戻す</button>
              )}
            </div>
          ))}
          <p className="tiny muted" style={{ marginBottom: 0 }}>アップロードされただけでは承認になりません。条件分岐で非表示の項目は「対象外」として分母から除外されます。</p>
        </section>
      )}

      {tab === 'answers' && (
        <section className="card">
          <div className="row between" style={{ marginBottom: 8 }}>
            <span className="small muted">非表示の質問への回答は保持されますが、進捗・Ready・パックには使われません。</span>
            <a className="btn btn-sm" href={`/api/cases/${id}/export.csv`}>CSV出力</a>
          </div>
          {def.sections.map((s: any) => {
            const qs = def.questions.filter((q: any) => q.sectionId === s.id && q.type !== 'file' && q.type !== 'image')
            if (!qs.length) return null
            return (
              <div key={s.id} style={{ marginBottom: 14 }}>
                <h3>{s.title}</h3>
                <table className="table"><tbody>
                  {qs.map((q: Question) => (
                    <tr key={q.id} style={{ opacity: visible[q.id] === false ? 0.45 : 1 }}>
                      <th style={{ width: '38%' }}>{q.label}{visible[q.id] === false && <span className="tiny"> （非表示）</span>}</th>
                      <td style={{ whiteSpace: 'pre-wrap' }}>{answerText(q, d.answers[q.id])}{comp.invalid.find((x: any) => x.questionId === q.id) && <div className="err">{comp.invalid.find((x: any) => x.questionId === q.id).message}</div>}</td>
                    </tr>
                  ))}
                </tbody></table>
              </div>
            )
          })}
        </section>
      )}

      {tab === 'ai' && (
        <div>
          <section className="card">
            <div className="card-title">
              <h2 style={{ margin: 0 }}>AIの確認候補</h2>
              {can(me, 'ai.run') && <button className="btn btn-sm" disabled={!c.ai_enabled} onClick={() => run(async () => { const r = await api(`/api/cases/${id}/ai/run`, { method: 'POST' }); if (r.skipped) throw new Error('AIはOFFです') }, 'AIチェックを実行しました')}>AIチェックを実行</button>}
            </div>
            <p className="small muted" style={{ marginTop: 0 }}>AIの指摘は「候補」です。自動で回答を修正したり、要件として確定したりしません。採用するかは担当者が決めます。</p>
            {!d.candidates.length && <div className="empty small">候補はありません</div>}
            <ul className="list">
              {d.candidates.map((x: any) => (
                <li key={x.id} style={{ opacity: x.status === 'open' ? 1 : 0.55 }}>
                  <div className="row"><span className={`badge ${x.kind === 'contradiction' ? 'b-needs_client' : 'b-submitted'}`}>{KIND[x.kind] ?? x.kind}</span>{x.payload.stale && <span className="badge b-draft">回答が更新されました</span>}<span className="tiny muted">{x.status} / {x.provider}</span></div>
                  <div style={{ marginTop: 4 }}>{x.payload.text}</div>
                  {x.payload.reason && <div className="small muted">理由：{x.payload.reason}</div>}
                  {x.payload.options && <div className="small muted">選択肢候補：{x.payload.options.join(' / ')}</div>}
                  <div className="tiny muted">出典：{(x.payload.sourceRefs ?? []).map((r: any) => r.questionId ? def.questions.find((q: any) => q.id === r.questionId)?.label ?? r.questionId : `file:${String(r.fileId).slice(0, 8)}`).join('、')}</div>
                  {x.status === 'open' && canReview && (
                    <div className="row" style={{ marginTop: 6 }}>
                      <button className="btn btn-sm btn-primary" onClick={() => ask('クライアントに追加質問する', '質問文（クライアントのポータルに表示されます）', (v) => api(`/api/candidates/${x.id}/resolve`, { body: { decision: 'send_to_client', text: v } }).then(() => { toast('追加質問を表示しました'); reload() }), true, x.payload.text)}>確認して質問する</button>
                      <button className="btn btn-sm" onClick={() => ask('解決済みにする', 'メモ（任意）', (v) => api(`/api/candidates/${x.id}/resolve`, { body: { decision: 'resolve', note: v } }).then(() => reload()), false)}>社内で解決</button>
                      <button className="btn btn-sm btn-ghost" onClick={() => run(() => api(`/api/candidates/${x.id}/resolve`, { body: { decision: 'dismiss' } }), '却下しました')}>却下</button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
          <section className="card">
            <div className="card-title"><h2 style={{ margin: 0 }}>追加質問（クライアントに表示中）</h2>
              {canReview && <button className="btn btn-sm" onClick={() => ask('追加で確認する', '質問文', (v) => api(`/api/cases/${id}/followups`, { body: { text: v } }).then(() => { toast('追加しました'); reload() }))}>＋ 手動で追加</button>}
            </div>
            {!d.followups.length && <div className="empty small">追加質問はありません</div>}
            <ul className="list">
              {d.followups.map((f: any) => (
                <li key={f.id}>
                  <div className="row"><span className={`badge b-${f.status === 'answered' ? 'submitted' : f.status === 'resolved' ? 'accepted' : f.status === 'open' ? 'needs_client' : 'draft'}`}>{({ open: '回答待ち', answered: '回答あり（要確認）', resolved: '確認済み', cancelled: '取消' } as any)[f.status]}</span></div>
                  <div style={{ marginTop: 4 }}>{f.text}</div>
                  {f.answer && <div className="small">回答：<b>{typeof f.answer === 'string' ? f.answer : JSON.stringify(f.answer)}</b></div>}
                  {canReview && f.status === 'answered' && (
                    <div className="row" style={{ marginTop: 6 }}>
                      {f.question_id && <button className="btn btn-sm btn-primary" onClick={() => run(() => api(`/api/followups/${f.id}/resolve`, { body: { decision: 'resolve', applyToQuestion: true } }), '回答に反映して確認済みにしました')}>元の回答に追記して確認済み</button>}
                      <button className="btn btn-sm" onClick={() => run(() => api(`/api/followups/${f.id}/resolve`, { body: { decision: 'resolve' } }), '確認済みにしました')}>確認済み</button>
                      <button className="btn btn-sm btn-ghost" onClick={() => run(() => api(`/api/followups/${f.id}/resolve`, { body: { decision: 'reopen' } }), '再質問にしました')}>再質問</button>
                    </div>
                  )}
                  {canReview && f.status === 'open' && <button className="btn btn-sm btn-ghost" onClick={() => run(() => api(`/api/followups/${f.id}/resolve`, { body: { decision: 'cancel' } }), '取り消しました')}>取消</button>}
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}

      {tab === 'reminders' && (
        <section className="card">
          <div className="card-title"><h2 style={{ margin: 0 }}>リマインド</h2>
            {can(me, 'case.edit') && <button className="btn btn-sm" onClick={() => run(() => api(`/api/cases/${id}/reminders`, { method: 'POST' }), '下書きを作成しました')}>未提出項目で下書きを作成</button>}
          </div>
          <p className="small muted" style={{ marginTop: 0 }}>期限前・当日・期限超過に、未提出の項目だけを含む下書きを自動作成します（重複作成なし・深夜は送信しません）。初期設定では送信前に担当者の承認が必要です。{!c.client_email && ' ※ クライアントのメールアドレスが未設定です。'}</p>
          {!d.reminders.length && <div className="empty small">リマインドはまだありません</div>}
          <ul className="list">
            {d.reminders.map((r: any) => (
              <li key={r.id}>
                <div className="row between"><div className="row"><span className={`badge b-${r.status === 'sent' ? 'accepted' : r.status === 'failed' ? 'missing' : r.status === 'draft' ? 'needs_client' : 'draft'}`}>{r.status}</span><b className="small">{r.subject}</b></div><span className="tiny muted">{r.stage} / 予定 {fmtDateTime(r.scheduled_for)}</span></div>
                <pre className="md" style={{ maxHeight: 180, marginTop: 6 }}>{r.body}</pre>
                {r.status === 'draft' && can(me, 'reminder.send') && (
                  <div className="row">
                    <button className="btn btn-sm btn-primary" disabled={!c.client_email} onClick={() => { if (confirm(`${c.client_email} へ送信します。よろしいですか？`)) run(() => api(`/api/reminders/${r.id}/approve`, { body: { includeNewLink: true } }), '承認しました（送信キューへ）') }}>承認して送信（新しいリンク付き）</button>
                    <button className="btn btn-sm" disabled={!c.client_email} onClick={() => { if (confirm(`${c.client_email} へ送信します。よろしいですか？`)) run(() => api(`/api/reminders/${r.id}/approve`, { body: {} }), '承認しました（送信キューへ）') }}>リンクなしで送信</button>
                    <button className="btn btn-sm btn-ghost" onClick={() => run(() => api(`/api/reminders/${r.id}/cancel`, { method: 'POST' }), '取り消しました')}>取消</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          <p className="tiny muted">メール送信は「メールプロバイダ設定」に従います。初期状態はローカル記録（実送信なし）です。</p>
        </section>
      )}

      {tab === 'links' && (
        <section className="card">
          <div className="card-title"><h2 style={{ margin: 0 }}>共有リンク</h2>
            {can(me, 'link.manage') && <div className="row">
              <select className="input" style={{ maxWidth: 140, minHeight: 34, padding: 4 }} value={linkDays} onChange={(e) => setLinkDays(Number(e.target.value))} aria-label="有効期限（日）">{[3, 7, 14, 30, 60, 90].map((d) => <option key={d} value={d}>{d}日有効</option>)}</select>
              <button className="btn btn-sm" onClick={() => run(async () => setLink(await api(`/api/cases/${id}/links`, { body: { days: linkDays } })), '発行しました')}>発行</button>
              <button className="btn btn-sm" onClick={() => run(async () => setLink(await api(`/api/cases/${id}/links`, { body: { revokeExisting: true, days: linkDays } })), '再発行しました（古いリンクは無効）')}>再発行（既存を無効化）</button>
              {c.client_email && <button className="btn btn-sm" onClick={() => run(async () => setLink(await api(`/api/cases/${id}/links`, { body: { requireEmailVerification: true, days: linkDays } })), 'メール確認付きリンクを発行しました')}>メール確認付きで発行</button>}
            </div>}
          </div>
          <p className="small muted" style={{ marginTop: 0 }}>リンクには有効期限があり、いつでも無効化できます。リンク本体はサーバーに保存されず、発行時に一度だけ表示されます。</p>
          <table className="table"><thead><tr><th>発行</th><th>有効期限</th><th>状態</th><th>最終利用</th><th></th></tr></thead><tbody>
            {d.links.map((l: any) => {
              const expired = new Date(l.expires_at) < new Date()
              return (
                <tr key={l.id}><td>{fmtDateTime(l.created_at)}</td><td>{fmtDate(l.expires_at)}</td>
                  <td>{l.revoked_at ? <span className="badge b-draft">無効化</span> : expired ? <span className="badge b-draft">期限切れ</span> : <span className="badge b-accepted">有効</span>}{l.require_email_verification && <span className="tiny muted"> メール確認{l.email_verified_at ? '済' : '待ち'}</span>}</td>
                  <td>{fmtDateTime(l.last_used_at)}</td>
                  <td>{!l.revoked_at && !expired && can(me, 'link.manage') && <button className="btn btn-sm btn-danger" onClick={() => run(() => api(`/api/cases/${id}/links/${l.id}`, { method: 'DELETE' }), '無効化しました')}>無効化</button>}</td></tr>
              )
            })}
          </tbody></table>
        </section>
      )}

      {tab === 'package' && (
        <section className="card">
          <div className="card-title"><h2 style={{ margin: 0 }}>案件開始パック / Handoff</h2></div>
          {c.status !== 'ready' && c.status !== 'started' && <div className="alert alert-warn small" style={{ marginBottom: 10 }}>この案件はまだReadyではありません。生成できますが、未確定事項（Unknown / Open Questions）を含みます。</div>}
          <div className="row">
            <select className="input" style={{ maxWidth: 320 }} value={profile} onChange={(e) => setProfile(e.target.value)} aria-label="Handoffプロファイル">
              <option value="">テンプレートの既定プロファイル</option>
              {PROFILES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            {can(me, 'package.generate') && <button className="btn btn-primary" onClick={() => run(async () => { const r = await api(`/api/cases/${id}/packages`, { body: profile ? { profile } : {} }); setPkg({ id: r.id, markdown: r.markdown }) }, 'パックを生成しました')}>パックを生成</button>}
          </div>
          <p className="tiny muted">回答・ファイルの出典（質問ID / ファイルID）付き。回答にない要件は作りません。Developer Handoffのページ構成・受入基準は「候補」です。</p>
          {pkg && (
            <div>
              <div className="row" style={{ margin: '8px 0' }}>
                <a className="btn btn-sm" href={`/api/packages/${pkg.id}?format=md`}>Markdown</a>
                <a className="btn btn-sm" href={`/api/packages/${pkg.id}?format=txt`}>TXT</a>
                <a className="btn btn-sm" href={`/api/packages/${pkg.id}`} target="_blank" rel="noopener">JSON</a>
                <button className="btn btn-sm" onClick={() => { navigator.clipboard?.writeText(pkg.markdown); toast('コピーしました（Claude Codeに貼り付けできます）') }}>コピー</button>
                <button className="btn btn-sm" onClick={() => window.print()}>印刷 / PDF保存</button>
              </div>
              <pre className="md">{pkg.markdown}</pre>
            </div>
          )}
          <h3 style={{ marginTop: 16 }}>生成履歴</h3>
          <ul className="list">{d.packages.map((p: any) => <li key={p.id} className="row between"><span>v{p.version}・{p.profile}・{fmtDateTime(p.created_at)}</span><span className="row"><button className="btn btn-sm" onClick={async () => { const r = await api(`/api/packages/${p.id}`); setPkg({ id: p.id, markdown: r.markdown }) }}>表示</button><a className="btn btn-sm" href={`/api/packages/${p.id}?format=md`}>MD</a></span></li>)}</ul>
        </section>
      )}

      {tab === 'history' && (
        <div className="grid grid-2">
          <section className="card"><h2>レビュー履歴</h2>
            <ul className="list">{d.reviews.map((r: any) => <li key={r.id} className="small"><b>{r.decision}</b> {r.target_type}:{String(r.target_id).slice(0, 24)} {r.note && `— ${r.note}`}<div className="tiny muted">{r.actor_name ?? r.actor_type}・{fmtDateTime(r.created_at)}</div></li>)}</ul>
          </section>
          <section className="card"><h2>監査ログ</h2>
            <ul className="list">{d.audit.map((a: any) => <li key={a.id} className="small"><span className="mono">{a.action}</span> <span className="muted">{a.actor_type}</span><div className="tiny muted">{fmtDateTime(a.created_at)}</div></li>)}</ul>
          </section>
        </div>
      )}

      {tab === 'settings' && (
        <section className="card stack">
          <h2>案件の設定</h2>
          <label className="check"><input type="checkbox" checked={c.ai_enabled} disabled={!can(me, 'case.edit')} onChange={(e) => run(() => api(`/api/cases/${id}`, { method: 'PATCH', body: { aiEnabled: e.target.checked } }), e.target.checked ? 'AIをONにしました' : 'AIをOFFにしました（AI用インデックスも削除）')} /><span>この案件でAIを使う<div className="help">OFFにするとAIプロバイダへの呼び出しは0になり、AI用の抽出テキストも削除されます。</div></span></label>
          <label className="field"><span>目標日</span><input className="input" type="date" style={{ maxWidth: 220 }} defaultValue={fmtDate(c.target_ready_date) === '—' ? '' : fmtDate(c.target_ready_date)} onBlur={(e) => run(() => api(`/api/cases/${id}`, { method: 'PATCH', body: { targetReadyDate: e.target.value || null } }), '更新しました')} /></label>
          <label className="field"><span>クライアントのメール</span><input className="input" type="email" style={{ maxWidth: 320 }} defaultValue={c.client_email ?? ''} onBlur={(e) => run(() => api(`/api/cases/${id}`, { method: 'PATCH', body: { clientEmail: e.target.value || null } }), '更新しました')} /></label>
          <div className="row">
            {can(me, 'case.edit') && <button className="btn" onClick={() => run(() => api(`/api/cases/${id}`, { method: 'PATCH', body: { status: 'archived' } }), 'アーカイブしました')}>アーカイブ</button>}
            {can(me, 'case.edit') && <button className="btn" onClick={() => run(() => api(`/api/cases/${id}`, { method: 'PATCH', body: { status: 'cancelled' } }), 'キャンセルしました')}>キャンセル</button>}
            {can(me, 'case.delete') && <button className="btn btn-danger" onClick={() => { if (confirm('この案件の回答・ファイル・AIインデックスを完全に削除します。元に戻せません。')) run(async () => { await api(`/api/cases/${id}`, { method: 'DELETE' }); nav('/app/cases') }, '削除しました') }}>案件を完全削除</button>}
          </div>
        </section>
      )}

      {prompt && <PromptModal {...prompt} onClose={() => setPrompt(null)} />}
    </div>
  )
}

function PromptModal({ title, label, required, initial, onOk, onClose }: { title: string; label: string; required?: boolean; initial?: string; onOk: (v: string) => Promise<void>; onClose: () => void }) {
  const [v, setV] = useState(initial ?? '')
  const [err, setErr] = useState<string | null>(null)
  return (
    <Modal title={title} onClose={onClose}>
      <form className="stack" onSubmit={async (e) => { e.preventDefault(); try { await onOk(v); onClose() } catch (x: any) { setErr(x.message) } }}>
        <label className="field"><span>{label}</span><textarea className="input" value={v} onChange={(e) => setV(e.target.value)} required={required} autoFocus /></label>
        {err && <div className="alert alert-danger">{err}</div>}
        <button className="btn btn-primary btn-block">OK</button>
      </form>
    </Modal>
  )
}
