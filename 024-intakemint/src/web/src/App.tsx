import React, { createContext, useContext, useEffect, useState } from 'react'
import { Navigate, NavLink, Route, Routes, useNavigate, useLocation } from 'react-router-dom'
import { api, setCsrf } from './api'
import { Icon, Logo } from './components/ui'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Cases from './pages/Cases'
import CaseDetail from './pages/CaseDetail'
import Templates from './pages/Templates'
import TemplateBuilder from './pages/TemplateBuilder'
import SearchPage from './pages/Search'
import Settings from './pages/Settings'
import Portal from './pages/Portal'
import Notifications from './pages/Notifications'

export interface Me { user: { id: string; name: string; email: string }; orgId: string; role: string; csrf: string; orgs: { id: string; name: string; role: string; is_sample: boolean }[]; settings: any; permissions: string[] }
const MeCtx = createContext<{ me: Me | null; reload: () => Promise<void> }>({ me: null, reload: async () => {} })
export const useMe = () => useContext(MeCtx)
export const can = (me: Me | null, p: string) => !!me?.permissions.includes(p)

function Shell({ children }: { children: React.ReactNode }) {
  const { me } = useMe()
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [unread, setUnread] = useState(0)
  const loc = useLocation()
  useEffect(() => { api<any[]>('/api/org/notifications').then((r) => setUnread(r.filter((n) => !n.read_at).length)).catch(() => {}) }, [loc.pathname])
  const org = me?.orgs.find((o) => o.id === me.orgId)
  const items = [
    ['/app', 'ダッシュボード', Icon.home, true], ['/app/cases', '案件', Icon.cases], ['/app/templates', 'フォーム', Icon.form], ['/app/search', '検索', Icon.search], ['/app/settings', '設定', Icon.gear],
  ] as const
  return (
    <div className="shell">
      <aside className="sidebar" aria-label="メインメニュー">
        <div className="brand"><Logo size={30} sub /></div>
        <nav className="nav">
          {items.map(([to, label, icon, end]) => <NavLink key={to} to={to} end={!!end}>{icon}{label}</NavLink>)}
        </nav>
        <div style={{ marginTop: 'auto' }} className="small muted">
          <div style={{ fontWeight: 600, color: 'var(--charcoal)' }}>{org?.name}</div>
          {org?.is_sample && <div className="badge b-needs_client" style={{ marginTop: 4 }}>サンプル環境</div>}
          <div>{me?.user.name}（{me?.role}）</div>
          <button className="btn btn-ghost btn-sm" style={{ paddingLeft: 0 }} onClick={async () => { await api('/api/auth/logout', { method: 'POST' }); location.href = '/login' }}>ログアウト</button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <span className="mobile-brand"><Logo size={24} withText={false} /></span>
          <form className="search" role="search" onSubmit={(e) => { e.preventDefault(); nav(`/app/search?q=${encodeURIComponent(q)}`) }}>
            <input className="input" style={{ minHeight: 38, padding: '7px 12px' }} placeholder="案件・クライアント・回答・ファイルを検索" value={q} onChange={(e) => setQ(e.target.value)} aria-label="検索" />
          </form>
          <NavLink to="/app/notifications" className="btn btn-ghost btn-sm" aria-label={`通知 ${unread}件`} style={{ position: 'relative' }}>
            {Icon.bell}{unread > 0 && <span className="badge b-missing" style={{ position: 'absolute', top: -2, right: -4, padding: '0 6px' }}>{unread}</span>}
          </NavLink>
        </header>
        <main className="content" id="main">{children}</main>
      </div>
      <nav className="tabbar" aria-label="タブ">
        {items.map(([to, label, icon, end]) => <NavLink key={to} to={to} end={!!end}>{icon}<span>{label}</span></NavLink>)}
      </nav>
    </div>
  )
}

function Internal() {
  const [me, setMe] = useState<Me | null>(null)
  const [state, setState] = useState<'loading' | 'ok' | 'anon'>('loading')
  const reload = async () => {
    try { const m = await api<Me>('/api/me'); setCsrf(m.csrf); setMe(m); setState('ok') } catch { setState('anon') }
  }
  useEffect(() => { reload() }, [])
  if (state === 'loading') return <div className="empty">読み込み中…</div>
  if (state === 'anon') return <Navigate to="/login" replace />
  return (
    <MeCtx.Provider value={{ me, reload }}>
      <Shell>
        <Routes>
          <Route index element={<Dashboard />} />
          <Route path="cases" element={<Cases />} />
          <Route path="cases/:id" element={<CaseDetail />} />
          <Route path="templates" element={<Templates />} />
          <Route path="templates/:id" element={<TemplateBuilder />} />
          <Route path="search" element={<SearchPage />} />
          <Route path="settings" element={<Settings />} />
          <Route path="notifications" element={<Notifications />} />
          <Route path="*" element={<Navigate to="/app" replace />} />
        </Routes>
      </Shell>
    </MeCtx.Provider>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Login signup />} />
      <Route path="/p/:token" element={<Portal />} />
      <Route path="/app/*" element={<Internal />} />
      <Route path="*" element={<Navigate to="/app" replace />} />
    </Routes>
  )
}
