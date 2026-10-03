import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { Modal, useAsync, useToast } from '../components/ui'
import { CaseCard } from './Dashboard'
import { CASE_STATUS_LABEL } from '../../../shared/completeness'
import { can, useMe } from '../App'

const FILTERS = ['', 'draft', 'sent', 'in_progress', 'needs_client', 'needs_internal_review', 'ready', 'started', 'archived']

export function NewCaseModal({ onClose }: { onClose: () => void }) {
  const nav = useNavigate()
  const toast = useToast()
  const { data: templates } = useAsync(() => api<any[]>('/api/templates'))
  const published = (templates ?? []).filter((t) => t.status === 'published')
  const [f, setF] = useState({ templateId: '', clientName: '', clientEmail: '', projectName: '', targetReadyDate: '' })
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { if (!f.templateId && published[0]) setF((x) => ({ ...x, templateId: published[0].id })) }, [templates])
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const r = await api<{ id: string }>('/api/cases', { body: { ...f, targetReadyDate: f.targetReadyDate || undefined, clientEmail: f.clientEmail || undefined } })
      toast('案件を作成しました'); nav(`/app/cases/${r.id}`)
    } catch (e: any) { setErr(e.message) }
  }
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value })
  return (
    <Modal title="新しい案件" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        {published.length === 0 && <div className="alert alert-warn">公開済みのフォームがありません。先に「フォーム」でテンプレートを公開してください。</div>}
        <label className="field"><span>フォーム（テンプレート）</span>
          <select className="input" value={f.templateId} onChange={set('templateId')} required>
            {published.map((t) => <option key={t.id} value={t.id}>{t.name}（v{t.current_version}）</option>)}
          </select></label>
        <label className="field"><span>クライアント名</span><input className="input" required value={f.clientName} onChange={set('clientName')} /></label>
        <label className="field"><span>クライアントのメール（任意・リマインド用）</span><input className="input" type="email" value={f.clientEmail} onChange={set('clientEmail')} /></label>
        <label className="field"><span>案件名</span><input className="input" required value={f.projectName} onChange={set('projectName')} placeholder="例：コーポレートサイト制作" /></label>
        <label className="field"><span>準備完了の目標日</span><input className="input" type="date" value={f.targetReadyDate} onChange={set('targetReadyDate')} /></label>
        {err && <div className="alert alert-danger">{err}</div>}
        <button className="btn btn-primary btn-block" disabled={!published.length}>作成する</button>
      </form>
    </Modal>
  )
}

export default function Cases() {
  const [sp, setSp] = useSearchParams()
  const { me } = useMe()
  const [status, setStatus] = useState('')
  const [q, setQ] = useState('')
  const { data, loading } = useAsync(() => api<any[]>(`/api/cases?${new URLSearchParams({ ...(status ? { status } : {}), ...(q ? { q } : {}) })}`), [status, q])
  return (
    <div>
      <div className="row between" style={{ marginBottom: 14 }}>
        <h1 style={{ margin: 0 }}>案件一覧</h1>
        {can(me, 'case.create') && <button className="btn btn-primary" onClick={() => setSp({ new: '1' })}>＋ 新しい案件</button>}
      </div>
      <div className="row" style={{ marginBottom: 12 }}>
        <input className="input" style={{ maxWidth: 320 }} placeholder="案件名・クライアント名で絞り込み" value={q} onChange={(e) => setQ(e.target.value)} aria-label="絞り込み" />
        <select className="input" style={{ maxWidth: 240 }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="ステータス">
          {FILTERS.map((s) => <option key={s} value={s}>{s ? CASE_STATUS_LABEL[s] : 'すべてのステータス'}</option>)}
        </select>
      </div>
      {loading && !data ? <div className="empty">読み込み中…</div> : data?.length ? <div className="grid grid-2">{data.map((c) => <CaseCard key={c.id} c={c} />)}</div> : <div className="card empty">案件がありません</div>}
      {sp.get('new') && <NewCaseModal onClose={() => setSp({})} />}
    </div>
  )
}
