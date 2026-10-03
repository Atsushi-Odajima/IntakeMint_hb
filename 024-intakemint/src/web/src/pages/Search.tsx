import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { CaseBadge } from '../components/ui'

const TYPE: Record<string, string> = { case: '案件', response: '回答', file: 'ファイル' }

export default function SearchPage() {
  const [sp, setSp] = useSearchParams()
  const [q, setQ] = useState(sp.get('q') ?? '')
  const [rows, setRows] = useState<any[] | null>(null)
  useEffect(() => {
    const term = sp.get('q') ?? ''
    setQ(term)
    if (!term) { setRows(null); return }
    api<any[]>(`/api/search?q=${encodeURIComponent(term)}`).then(setRows).catch(() => setRows([]))
  }, [sp])
  return (
    <div>
      <h1>検索</h1>
      <form className="row" onSubmit={(e) => { e.preventDefault(); setSp({ q }) }} role="search">
        <input className="input" style={{ maxWidth: 420 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="案件名・クライアント・回答・ファイル名・タグ" aria-label="検索語" />
        <button className="btn btn-primary">検索</button>
      </form>
      <p className="tiny muted">検索結果は自分の組織のデータのみです（サーバー側で権限フィルタ済み）。</p>
      {rows && (rows.length ? (
        <div className="card"><ul className="list">
          {rows.map((r) => (
            <li key={r.entity_type + r.entity_id}>
              <div className="row between">
                <div><span className="badge b-draft">{TYPE[r.entity_type] ?? r.entity_type}</span> <Link to={`/app/cases/${r.case_id}`} style={{ fontWeight: 600 }}>{r.title}</Link></div>
                {r.status && <CaseBadge status={r.status} />}
              </div>
              <div className="small muted">{r.project_name} / {r.client_name}</div>
              {r.snippet && <div className="small" style={{ marginTop: 4 }}>{r.snippet}</div>}
            </li>
          ))}
        </ul></div>
      ) : <div className="card empty">見つかりませんでした</div>)}
    </div>
  )
}
