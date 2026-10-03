import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, fmtDateTime } from '../api'
import { Modal, useAsync, useToast } from '../components/ui'
import { can, useMe } from '../App'

const ST: Record<string, string> = { draft: '下書き', published: '公開中', archived: 'アーカイブ' }

export default function Templates() {
  const { me } = useMe()
  const nav = useNavigate()
  const toast = useToast()
  const { data } = useAsync(() => api<any[]>('/api/templates'))
  const { data: samples } = useAsync(() => api<any[]>('/api/templates/samples'))
  const [open, setOpen] = useState(false)
  const create = async (sampleKey?: string, name?: string) => {
    try {
      const t = await api('/api/templates', { body: { name: name ?? '新しいフォーム', sampleKey } })
      toast('フォームを作成しました'); nav(`/app/templates/${t.id}`)
    } catch (e: any) { toast(e.message) }
  }
  return (
    <div>
      <div className="row between" style={{ marginBottom: 14 }}>
        <h1 style={{ margin: 0 }}>フォーム（ヒアリングテンプレート）</h1>
        {can(me, 'template.edit') && <button className="btn btn-primary" onClick={() => setOpen(true)}>＋ フォームを作る</button>}
      </div>
      <div className="card">
        {!data?.length ? <div className="empty">まだフォームがありません。業種別サンプルから始められます。</div> : (
          <div className="table-wrap"><table className="table"><thead><tr><th>名前</th><th>業種</th><th>状態</th><th>公開版</th><th>更新</th></tr></thead><tbody>
            {data.map((t) => <tr key={t.id}><td><Link to={`/app/templates/${t.id}`} style={{ fontWeight: 600 }}>{t.name}</Link><div className="tiny muted">{t.description}</div></td><td>{t.industry}</td><td><span className={`badge b-${t.status === 'published' ? 'accepted' : 'draft'}`}>{ST[t.status]}</span></td><td>{t.current_version ? `v${t.current_version}` : '—'}</td><td className="small">{fmtDateTime(t.updated_at)}</td></tr>)}
          </tbody></table></div>
        )}
      </div>
      <p className="tiny muted">公開済みのフォームを編集しても、既存の案件には反映されません（公開すると新しいバージョンになり、新規案件から使われます）。</p>
      {open && (
        <Modal title="フォームを作る" onClose={() => setOpen(false)}>
          <p className="small muted" style={{ marginTop: 0 }}>業種別サンプルから始めるのがおすすめです。サンプルは出発点であり、法的に必要な書類の網羅を保証するものではありません。</p>
          <div className="stack">
            {samples?.map((s) => (
              <button key={s.key} className="case-card" style={{ textAlign: 'left', width: '100%', cursor: 'pointer' }} onClick={() => create(s.key, s.name)}>
                <b>{s.name}</b><div className="small muted">{s.description}</div>
              </button>
            ))}
            <button className="btn btn-block" onClick={() => create()}>白紙から作る</button>
          </div>
        </Modal>
      )}
    </div>
  )
}
