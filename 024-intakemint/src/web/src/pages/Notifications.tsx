import { Link } from 'react-router-dom'
import { api, fmtDateTime } from '../api'
import { useAsync } from '../components/ui'

export default function Notifications() {
  const { data, reload } = useAsync(() => api<any[]>('/api/org/notifications'))
  return (
    <div>
      <div className="row between" style={{ marginBottom: 14 }}>
        <h1 style={{ margin: 0 }}>通知</h1>
        <button className="btn btn-sm" onClick={async () => { await api('/api/org/notifications/read', { method: 'POST' }); reload() }}>すべて既読にする</button>
      </div>
      <div className="card">
        {!data?.length ? <div className="empty">通知はありません</div> : (
          <ul className="list">
            {data.map((n) => (
              <li key={n.id} style={{ opacity: n.read_at ? 0.6 : 1 }}>
                <div className="row between">
                  <div>{n.case_id ? <Link to={`/app/cases/${n.case_id}`}>{n.title}</Link> : n.title}{n.count > 1 && <span className="badge b-draft" style={{ marginLeft: 6 }}>×{n.count}</span>}</div>
                  <span className="tiny muted">{fmtDateTime(n.updated_at)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="tiny muted">同じ案件・同じ種類の通知は10分以内にまとめて表示します（通知ストーム防止）。</p>
    </div>
  )
}
