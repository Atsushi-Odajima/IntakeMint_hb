import { Link } from 'react-router-dom'
import { api, fmtDate } from '../api'
import { CaseBadge, Progress, useAsync } from '../components/ui'

export function CaseCard({ c }: { c: any }) {
  const p = c.progress ?? {}
  const overdue = c.target_ready_date && String(c.target_ready_date).slice(0, 10) < new Date().toISOString().slice(0, 10) && !['ready', 'started', 'archived', 'cancelled'].includes(c.status)
  return (
    <Link className="case-card" to={`/app/cases/${c.id}`}>
      <div className="row between" style={{ flexWrap: 'nowrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.project_name}</div>
          <div className="small muted">{c.client_name}</div>
        </div>
        <CaseBadge status={c.status} />
      </div>
      <div className="row" style={{ marginTop: 10, flexWrap: 'nowrap' }}>
        <div style={{ flex: 1 }}><Progress value={p.percent ?? 0} label={`${c.project_name} の進捗`} /></div>
        <span className="small" style={{ fontWeight: 650, whiteSpace: 'nowrap' }}>{p.submitted ?? 0}/{p.denominator ?? 0}（{p.percent ?? 0}%）</span>
      </div>
      {c.missing_summary && c.status !== 'ready' && <div className="small" style={{ marginTop: 6, color: 'var(--warn)' }}>足りないもの：{c.missing_summary}</div>}
      <div className="tiny muted" style={{ marginTop: 4, color: overdue ? 'var(--danger)' : undefined }}>目標日 {fmtDate(c.target_ready_date)}{overdue ? '（期限超過）' : ''}</div>
    </Link>
  )
}

function Bucket({ title, rows, empty }: { title: string; rows: any[]; empty: string }) {
  return (
    <section className="card" aria-label={title}>
      <div className="card-title"><h2 style={{ margin: 0 }}>{title}</h2><span className="badge b-draft">{rows.length}</span></div>
      {rows.length ? rows.slice(0, 6).map((c) => <CaseCard key={c.id} c={c} />) : <div className="empty small">{empty}</div>}
    </section>
  )
}

export default function Dashboard() {
  const { data, error } = useAsync(() => api('/api/dashboard'))
  if (error) return <div className="alert alert-danger">{error}</div>
  if (!data) return <div className="empty">読み込み中…</div>
  const count = (s: string[]) => data.counts.filter((c: any) => s.includes(c.status)).reduce((a: number, c: any) => a + c.n, 0)
  const kpis = [
    ['進行中の案件', count(['draft', 'sent', 'in_progress', 'needs_client', 'needs_internal_review'])],
    ['クライアント待ち', count(['in_progress', 'needs_client', 'sent'])],
    ['内部確認待ち', count(['needs_internal_review'])],
    ['期限超過', data.overdue.length],
    ['Ready（開始可能）', count(['ready'])],
  ]
  return (
    <div>
      <div className="row between" style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>案件の準備状況</h1>
        <Link className="btn btn-primary" to="/app/cases?new=1">＋ 新しい案件</Link>
      </div>
      <div className="grid grid-kpi" style={{ marginBottom: 18 }}>
        {kpis.map(([l, n]) => <div key={l as string} className="card kpi"><div className="n">{n as number}</div><div className="l">{l}</div></div>)}
      </div>
      <div className="grid grid-2">
        <Bucket title="内部確認待ち（Needs Review）" rows={data.needsReview} empty="確認待ちの案件はありません" />
        <Bucket title="クライアント待ち" rows={data.waitingClient} empty="クライアント待ちの案件はありません" />
        <Bucket title="期限超過" rows={data.overdue} empty="期限超過はありません" />
        <Bucket title="Ready（開始可能）" rows={data.ready} empty="Readyの案件はまだありません" />
        <Bucket title="新規・送信済み" rows={data.newCases} empty="新規案件はありません" />
        <Bucket title="最近の更新" rows={data.recent} empty="まだ案件がありません" />
      </div>
    </div>
  )
}
