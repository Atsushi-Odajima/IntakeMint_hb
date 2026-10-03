// Client portal — no account. Mobile-first. Conditional logic is evaluated live in the browser;
// the server re-validates everything. Offline: answers are kept as a local draft only — uploads and
// final submission are disabled until the connection is back (never "confirmed" offline).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api, ApiError, fmtSize } from '../api'
import { Icon, ItemBadge, Logo, Progress } from '../components/ui'
import { evaluateLogic } from '../../../shared/logic'
import { validateAnswer } from '../../../shared/validate'
import type { Question, RequiredItem, TemplateDefinition } from '../../../shared/types'

type View = any

function useOnline() {
  const [on, setOn] = useState(typeof navigator === 'undefined' ? true : navigator.onLine)
  useEffect(() => {
    const a = () => setOn(true), b = () => setOn(false)
    window.addEventListener('online', a); window.addEventListener('offline', b)
    return () => { window.removeEventListener('online', a); window.removeEventListener('offline', b) }
  }, [])
  return on
}

const draftKey = (t: string) => `im-draft:${t.slice(0, 10)}`
const readDraft = (t: string): Record<string, unknown> => { try { return JSON.parse(localStorage.getItem(draftKey(t)) ?? '{}') } catch { return {} } }
const writeDraft = (t: string, d: Record<string, unknown>) => { try { if (Object.keys(d).length) localStorage.setItem(draftKey(t), JSON.stringify(d)); else localStorage.removeItem(draftKey(t)) } catch { /* storage unavailable */ } }

function acceptAttr(it: RequiredItem): string {
  const ex = (it.acceptedFormats ?? []).map((e) => `.${e}`)
  const imgs = (it.acceptedFormats ?? []).some((e) => ['jpg', 'jpeg', 'png', 'heic', 'webp'].includes(e))
  return [...ex, ...(imgs ? ['image/*'] : []), ...((it.acceptedFormats ?? []).includes('pdf') ? ['application/pdf'] : [])].join(',')
}

export default function Portal() {
  const { token = '' } = useParams()
  const online = useOnline()
  const [view, setView] = useState<View | null>(null)
  const [fatal, setFatal] = useState<string | null>(null)
  const [answers, setAnswers] = useState<Record<string, unknown>>({})
  const [pending, setPending] = useState<Record<string, unknown>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'offline' | 'error'>('idle')
  const [savedAt, setSavedAt] = useState<string>('')
  const [done, setDone] = useState<null | { complete: boolean }>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const timer = useRef<number | null>(null)

  const load = useCallback(async () => {
    try {
      const v = await api<View>(`/api/portal/${token}`)
      setView(v)
      if (!v.needsVerification) {
        const draft = readDraft(token)
        setAnswers({ ...v.answers, ...draft })
        setPending(draft)
      }
    } catch (e) { setFatal(e instanceof ApiError ? e.message : 'ページを読み込めませんでした') }
  }, [token])
  useEffect(() => { load() }, [load])

  const def: TemplateDefinition | null = view?.definition ?? null
  const logic = useMemo(() => (def ? evaluateLogic(def, answers) : null), [def, answers])

  const flush = useCallback(async (p: Record<string, unknown>) => {
    if (!Object.keys(p).length) return true
    if (!navigator.onLine) { setSaveState('offline'); return false }
    setSaveState('saving')
    try {
      const r = await api<{ saved: string[]; errors: { questionId: string; message: string }[]; progress: any }>(`/api/portal/${token}/answers`, { body: { answers: p } })
      const errs: Record<string, string> = {}
      for (const e of r.errors) errs[e.questionId] = e.message
      setErrors((x) => { const n = { ...x }; for (const k of Object.keys(p)) delete n[k]; return { ...n, ...errs } })
      setPending((cur) => { const n = { ...cur }; for (const k of Object.keys(p)) if (JSON.stringify(n[k]) === JSON.stringify(p[k]) && !errs[k]) delete n[k]; writeDraft(token, n); return n })
      setView((v: View) => ({ ...v, progress: r.progress }))
      setSaveState('saved'); setSavedAt(new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }))
      return r.errors.length === 0
    } catch { setSaveState('error'); return false }
  }, [token])

  // background refresh of statuses (items/files) after saves
  const refresh = useCallback(async () => { try { const v = await api<View>(`/api/portal/${token}`); setView(v) } catch { /* ignore */ } }, [token])

  const setAnswer = (q: Question, v: unknown) => {
    setAnswers((a) => ({ ...a, [q.id]: v }))
    const local = validateAnswer(q, v)
    setErrors((e) => { const n = { ...e }; if (local) n[q.id] = local; else delete n[q.id]; return n })
    setPending((p) => { const n = { ...p, [q.id]: v }; writeDraft(token, n); return n })
  }
  useEffect(() => {
    if (!Object.keys(pending).length) return
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => { flush(pending).then(() => refresh()) }, 1200)
    return () => { if (timer.current) window.clearTimeout(timer.current) }
  }, [pending, flush, refresh])
  useEffect(() => { if (online && Object.keys(pending).length) flush(pending).then(() => refresh()) }, [online]) // sync draft when back online

  if (fatal) return <div className="portal"><div className="portal-head"><Logo size={26} /></div><div className="alert alert-danger" role="alert">{fatal}</div></div>
  if (!view) return <div className="portal"><div className="empty">読み込み中…</div></div>
  if (view.needsVerification) return <Verify token={token} branding={view.branding} onDone={load} />
  if (!def || !logic) return null

  const brand = view.branding ?? {}
  const items: any[] = view.items
  const itemById = new Map(items.map((i) => [i.itemId, i]))
  const fileItems = def.requiredItems.filter((i) => i.type === 'file' && itemById.get(i.id)?.applicable)
  const linkedFileItems = new Set(def.questions.filter((q) => q.fileItemId).map((q) => q.fileItemId))
  const remaining = items.filter((i) => i.applicable && i.required && !['submitted', 'needs_review', 'accepted'].includes(i.status))
  const p = view.progress
  const openFollowups = (view.followups ?? []).filter((f: any) => f.status === 'open')

  const saveAndExit = async () => {
    const ok = await flush(pending)
    setMsg(ok ? '保存しました。このリンクからいつでも続きを入力できます。' : navigator.onLine ? '一部の回答に入力エラーがあります。赤字の項目を確認してください。' : 'オフラインのため、この端末に下書きとして保存しました。接続が戻ると自動で送信されます。')
  }
  const submit = async () => {
    const ok = await flush(pending)
    if (!ok) { setMsg('入力エラーのある項目があります。確認してから送信してください。'); return }
    if (remaining.length && !confirm(`まだ${remaining.length}件の必要項目が揃っていません。このまま送信しますか？（後から追加で提出できます）`)) return
    const r = await api<{ complete: boolean }>(`/api/portal/${token}/submit`, { method: 'POST' })
    setDone(r); refresh(); window.scrollTo({ top: 0 })
  }

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100%' }}>
      {!online && <div className="offline" role="status">オフラインです — 回答は端末に下書き保存されます。ファイル提出と最終送信は接続後に行えます。</div>}
      <div className="portal">
        <header className="portal-head">
          {brand.logoDataUrl ? <img src={brand.logoDataUrl} alt={brand.senderName} /> : <span style={{ width: 10, height: 28, borderRadius: 4, background: brand.color ?? 'var(--forest)', display: 'inline-block' }} aria-hidden />}
          <div style={{ minWidth: 0 }}>
            <div className="tiny muted">{brand.senderName}</div>
            <h1 style={{ margin: 0, fontSize: '1.15rem' }}>{view.case.projectName}</h1>
          </div>
        </header>

        {done && (
          <div className={`alert ${done.complete ? 'alert-ok' : 'alert-warn'}`} role="status" style={{ marginBottom: 12 }}>
            {done.complete ? (brand.completionMessage || view.completionMessage || 'ご提出ありがとうございました。') : '送信しました。まだ揃っていない項目があります。準備ができたら、このリンクから追加で提出してください。'}
          </div>
        )}
        {msg && <div className="alert alert-info" role="status" style={{ marginBottom: 12 }}>{msg}</div>}

        <section className="section-card" aria-label="進捗" style={{ marginTop: 0 }}>
          <div className="row between"><b>必要な情報 {p.denominator}件中 {p.submitted}件 提出済み</b><span style={{ fontWeight: 700, color: 'var(--forest)' }}>{p.percent}%</span></div>
          <div style={{ margin: '8px 0' }}><Progress value={p.percent} lg label="提出の進捗" /></div>
          {remaining.length > 0 ? (
            <div className="small">残り：{remaining.map((i) => `${i.label}${i.type === 'file' && i.status === 'partial' ? `（${i.count}/${i.minCount}）` : ''}`).join('・')}</div>
          ) : <div className="small" style={{ color: 'var(--mint-ink)', fontWeight: 600 }}>必要な項目はすべて提出済みです。担当者の確認をお待ちください。</div>}
          {items.filter((i) => i.status === 'rejected').map((i) => <div key={i.itemId} className="alert alert-danger small" style={{ marginTop: 8 }}>「{i.label}」の再提出をお願いします{i.note ? `：${i.note}` : ''}</div>)}
          <div className="tiny muted" style={{ marginTop: 6 }}>{saveState === 'saving' ? '保存中…' : saveState === 'saved' ? `自動保存しました（${savedAt}）` : saveState === 'offline' ? '端末に下書き保存中（オフライン）' : saveState === 'error' ? '保存に失敗しました。通信状況を確認してください' : '入力内容は自動で保存されます'}</div>
        </section>

        {(view.intro || brand.intro || def.intro) && <p className="small muted" style={{ margin: '14px 2px 0' }}>{brand.intro || view.intro || def.intro}</p>}

        {openFollowups.length > 0 && (
          <section className="section-card" aria-label="担当者からの追加質問" style={{ borderColor: '#e9c46a' }}>
            <h2>担当者からの追加のご質問</h2>
            {openFollowups.map((f: any) => <FollowupForm key={f.id} f={f} token={token} disabled={!online} onDone={refresh} />)}
          </section>
        )}

        {def.sections.map((s) => {
          const qs = def.questions.filter((q) => q.sectionId === s.id && logic.visible[q.id] !== false)
          if (!qs.length) return null
          return (
            <section key={s.id} className="section-card" aria-labelledby={`sec-${s.id}`}>
              <h2 id={`sec-${s.id}`}>{s.title}</h2>
              {s.description && <p className="small muted">{s.description}</p>}
              <div className="stack">
                {qs.map((q) => {
                  if ((q.type === 'file' || q.type === 'image') && q.fileItemId) {
                    const it = def.requiredItems.find((i) => i.id === q.fileItemId)
                    return it && itemById.get(it.id)?.applicable ? <FileItem key={q.id} it={it} label={q.label} help={q.help} token={token} view={view} online={online} onChange={refresh} /> : null
                  }
                  return <QuestionField key={q.id} q={q} value={answers[q.id]} required={!!logic.required[q.id]} error={errors[q.id]} onChange={(v) => setAnswer(q, v)} />
                })}
              </div>
            </section>
          )
        })}

        {fileItems.filter((i) => !linkedFileItems.has(i.id)).length > 0 && (
          <section className="section-card"><h2>提出ファイル</h2>
            <div className="stack">{fileItems.filter((i) => !linkedFileItems.has(i.id)).map((it) => <FileItem key={it.id} it={it} label={it.label} token={token} view={view} online={online} onChange={refresh} />)}</div>
          </section>
        )}
        <p className="tiny muted" style={{ textAlign: 'center', marginTop: 18 }}>Powered by <Logo size={14} /> — 提出内容は担当者のみが確認します。</p>
      </div>

      <div className="portal-bar">
        <div className="inner">
          <button className="btn" style={{ flex: 1 }} onClick={saveAndExit}>保存して終了</button>
          <button className="btn btn-primary" style={{ flex: 1.3 }} onClick={submit} disabled={!online} title={!online ? 'オフライン中は送信できません' : undefined}>{remaining.length ? `送信する（残り${remaining.length}）` : '送信する'}</button>
        </div>
      </div>
    </div>
  )
}

function QuestionField({ q, value, required, error, onChange }: { q: Question; value: unknown; required: boolean; error?: string; onChange: (v: unknown) => void }) {
  const id = `q-${q.id}`
  const lbl = <span className="field-label" id={`${id}-l`}>{q.label}{required && <span style={{ color: 'var(--danger)' }}> *</span>}</span>
  const common = { id, 'aria-labelledby': `${id}-l`, 'aria-invalid': !!error, className: `input ${error ? 'invalid' : ''}` }
  let control: React.ReactNode
  switch (q.type) {
    case 'long_text': control = <textarea {...common} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} placeholder={q.placeholder ?? '入力してください'} maxLength={q.maxLength ?? 10000} />; break
    case 'number': control = <input {...common} type="number" inputMode="decimal" value={(value as any) ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} min={q.min} max={q.max} />; break
    case 'date': control = <input {...common} type="date" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value || null)} />; break
    case 'email': control = <input {...common} type="email" inputMode="email" autoComplete="email" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />; break
    case 'phone': control = <input {...common} type="tel" inputMode="tel" autoComplete="tel" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />; break
    case 'url': control = <input {...common} type="url" inputMode="url" placeholder="https://" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />; break
    case 'single_choice':
      control = <div className="chips" role="radiogroup" aria-labelledby={`${id}-l`}>{q.options?.map((o) => <button type="button" key={o.value} role="radio" aria-checked={value === o.value} className={`chip ${value === o.value ? 'on' : ''}`} onClick={() => onChange(o.value)}>{o.label}</button>)}</div>; break
    case 'multiple_choice': {
      const arr = Array.isArray(value) ? (value as string[]) : []
      control = <div className="chips" role="group" aria-labelledby={`${id}-l`}>{q.options?.map((o) => { const on = arr.includes(o.value); return <button type="button" key={o.value} role="checkbox" aria-checked={on} className={`chip ${on ? 'on' : ''}`} onClick={() => onChange(on ? arr.filter((x) => x !== o.value) : [...arr, o.value])}>{o.label}</button> })}</div>; break
    }
    case 'yes_no': control = <div className="chips" role="radiogroup" aria-labelledby={`${id}-l`}>{[['yes', 'はい'], ['no', 'いいえ']].map(([v, l]) => <button type="button" key={v} role="radio" aria-checked={value === v} className={`chip ${value === v ? 'on' : ''}`} onClick={() => onChange(v)}>{l}</button>)}</div>; break
    case 'acknowledgement': return (
      <div><label className="check"><input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked ? true : null)} /><span>{q.label}{required && <span style={{ color: 'var(--danger)' }}> *</span>}</span></label>{error && <div className="err">{error}</div>}</div>
    )
    case 'repeating_group': {
      const rows = Array.isArray(value) && value.length ? (value as Record<string, string>[]) : [{}]
      control = (
        <div className="stack">
          {rows.map((r, idx) => (
            <div key={idx} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 10 }}>
              {(q.fields ?? []).map((f) => (
                <label key={f.id} className="field" style={{ marginBottom: 6 }}><span className="small">{f.label}</span>
                  <input className="input" type={f.type === 'url' ? 'url' : f.type === 'email' ? 'email' : f.type === 'number' ? 'number' : 'text'} value={r[f.id] ?? ''} onChange={(e) => onChange(rows.map((x, j) => (j === idx ? { ...x, [f.id]: e.target.value } : x)))} />
                </label>
              ))}
              {rows.length > 1 && <button type="button" className="btn btn-sm btn-ghost" onClick={() => onChange(rows.filter((_, j) => j !== idx))}>この行を削除</button>}
            </div>
          ))}
          {(q.maxRows ?? 20) > rows.length && <button type="button" className="btn btn-sm" onClick={() => onChange([...rows, {}])}>＋ 追加</button>}
        </div>
      ); break
    }
    default: control = <input {...common} type="text" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} placeholder={q.placeholder ?? ''} maxLength={q.maxLength ?? 500} />
  }
  return (
    <div>
      {q.type === 'repeating_group' || q.type.includes('choice') || q.type === 'yes_no' ? lbl : <label htmlFor={id}>{lbl}</label>}
      {control}
      {q.help && <div className="help">{q.help}</div>}
      {error && <div className="err" role="alert">{error}</div>}
    </div>
  )
}

function FileItem({ it, label, help, token, view, online, onChange }: { it: RequiredItem; label: string; help?: string; token: string; view: View; online: boolean; onChange: () => void }) {
  const ev = view.items.find((i: any) => i.itemId === it.id)
  const files = view.files.filter((f: any) => f.itemId === it.id)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [noAi, setNoAi] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const upload = async (list: FileList | null) => {
    if (!list?.length) return
    setErr(null)
    for (const file of Array.from(list)) {
      if (!navigator.onLine) { setErr('オフラインのためアップロードできません。接続後にもう一度お試しください。'); break }
      if (it.maxSizeMB && file.size > it.maxSizeMB * 1024 * 1024) { setErr(`${file.name}：${it.maxSizeMB}MBを超えています`); continue }
      setBusy(`${file.name} をアップロード中…`)
      const fd = new FormData()
      fd.append('itemId', it.id)
      fd.append('aiExcluded', String(noAi))
      fd.append('file', file, file.name)
      try { await api(`/api/portal/${token}/files`, { form: fd }) } catch (e: any) { setErr(`${file.name}：${e.message}`) }
    }
    setBusy(null)
    if (input.current) input.current.value = ''
    onChange()
  }
  return (
    <div>
      <div className="row between"><span className="field-label" style={{ margin: 0 }}>{label}{it.required && <span style={{ color: 'var(--danger)' }}> *</span>}</span>{ev && <span className="row small"><ItemBadge status={ev.status} /><b>{ev.count ?? 0}/{ev.minCount}</b></span>}</div>
      {help && <div className="help">{help}</div>}
      {it.notes && <div className="help">{it.notes}</div>}
      <div className="upload-box" style={{ marginTop: 8 }}>
        <div style={{ color: 'var(--forest)' }}>{Icon.upload}</div>
        <button type="button" className="btn btn-primary" disabled={!online || !!busy} onClick={() => input.current?.click()}>{busy ? 'アップロード中…' : 'ファイルを選択 / 撮影'}</button>
        <input ref={input} type="file" hidden multiple accept={acceptAttr(it)} aria-label={`${label}のファイル`} onChange={(e) => upload(e.target.files)} data-testid={`file-${it.id}`} />
        <div className="tiny muted" style={{ marginTop: 6 }}>{(it.acceptedFormats ?? []).map((x) => x.toUpperCase()).join(' / ')}{it.maxSizeMB ? `・1ファイル${it.maxSizeMB}MBまで` : ''}{(it.minCount ?? 1) > 1 ? `・${it.minCount}件必要` : ''}</div>
        <label className="check tiny" style={{ justifyContent: 'center' }}><input type="checkbox" checked={noAi} onChange={(e) => setNoAi(e.target.checked)} /><span>この資料はAI処理に使わない（機密資料など）</span></label>
        {!online && <div className="tiny" style={{ color: 'var(--danger)' }}>オフライン中はアップロードできません</div>}
        {busy && <div className="tiny" role="status">{busy}</div>}
      </div>
      {err && <div className="err" role="alert">{err}</div>}
      {files.length > 0 && (
        <ul className="list" style={{ marginTop: 6 }}>
          {files.map((f: any) => (
            <li key={f.id} className="row between" style={{ padding: '8px 0' }}>
              <span className="small" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.name} <span className="muted">{fmtSize(f.size)}</span>{f.aiExcluded && <span className="tiny muted">（AI対象外）</span>}{f.note && <div className="tiny" style={{ color: 'var(--danger)' }}>差し戻し：{f.note}</div>}</span>
              <span className="row">
                <ItemBadge status={f.status === 'pending_review' ? 'submitted' : f.status} />
                {f.status === 'pending_review' && <button type="button" className="btn btn-sm btn-ghost" disabled={!online} onClick={async () => { if (confirm(`${f.name} を削除しますか？`)) { await api(`/api/portal/${token}/files/${f.id}`, { method: 'DELETE' }); onChange() } }}>削除</button>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function FollowupForm({ f, token, disabled, onDone }: { f: any; token: string; disabled: boolean; onDone: () => void }) {
  const [v, setV] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const opts: string[] | null = Array.isArray(f.options) ? f.options : null
  return (
    <form className="stack" style={{ marginBottom: 12 }} onSubmit={async (e) => { e.preventDefault(); try { await api(`/api/portal/${token}/followups/${f.id}`, { body: { answer: v } }); onDone() } catch (x: any) { setErr(x.message) } }}>
      <div style={{ fontWeight: 600 }}>{f.text}</div>
      {opts && <div className="chips">{opts.map((o) => <button type="button" key={o} className={`chip ${v === o ? 'on' : ''}`} onClick={() => setV(o)}>{o}</button>)}</div>}
      <textarea className="input" value={v} onChange={(e) => setV(e.target.value)} placeholder="回答を入力" aria-label={f.text} />
      {err && <div className="err">{err}</div>}
      <button className="btn btn-primary" disabled={disabled || !v.trim()}>回答する</button>
    </form>
  )
}

function Verify({ token, branding, onDone }: { token: string; branding: any; onDone: () => void }) {
  const [sent, setSent] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [err, setErr] = useState<string | null>(null)
  return (
    <div className="portal">
      <div className="portal-head"><div><div className="tiny muted">{branding?.senderName}</div><h1 style={{ margin: 0, fontSize: '1.15rem' }}>メールアドレスの確認</h1></div></div>
      <div className="section-card stack">
        <p className="small">このページを開くには、担当者に登録されたメールアドレスで確認が必要です。</p>
        {!sent ? <button className="btn btn-primary" onClick={async () => { try { const r = await api(`/api/portal/${token}/verify/start`, { method: 'POST' }); setSent(r.sentTo) } catch (e: any) { setErr(e.message) } }}>確認コードを送る</button> : (
          <form className="stack" onSubmit={async (e) => { e.preventDefault(); try { await api(`/api/portal/${token}/verify`, { body: { code } }); onDone() } catch (x: any) { setErr(x.message) } }}>
            <div className="small">{sent} に6桁のコードを送りました。</div>
            <input className="input" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} aria-label="確認コード" />
            <button className="btn btn-primary">確認する</button>
          </form>
        )}
        {err && <div className="err">{err}</div>}
      </div>
    </div>
  )
}
