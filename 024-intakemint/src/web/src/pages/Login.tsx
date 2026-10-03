import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { api, setCsrf } from '../api'
import { Logo } from '../components/ui'

export default function Login({ signup = false }: { signup?: boolean }) {
  const nav = useNavigate()
  const [f, setF] = useState({ email: '', password: '', name: '', orgName: '' })
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null)
    try {
      const r = await api<{ csrf: string }>(signup ? '/api/auth/signup' : '/api/auth/login', { body: signup ? f : { email: f.email, password: f.password } })
      setCsrf(r.csrf); nav('/app')
    } catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value })
  return (
    <div className="login-wrap">
      <div className="login-card">
        <Logo size={40} sub />
        <p className="hero-copy">必要な情報が、1回でちゃんと揃う。</p>
        <p className="muted small" style={{ marginTop: 0 }}>仕事開始に必要な情報・ファイルを、AIが質問・不足確認・整理するツールです。</p>
        <form className="card stack" onSubmit={submit} style={{ marginTop: 18 }}>
          <h1 style={{ fontSize: '1.2rem' }}>{signup ? '新規登録' : 'ログイン'}</h1>
          {signup && <>
            <label className="field"><span>組織名</span><input className="input" required value={f.orgName} onChange={set('orgName')} autoComplete="organization" /></label>
            <label className="field"><span>お名前</span><input className="input" required value={f.name} onChange={set('name')} autoComplete="name" /></label>
          </>}
          <label className="field"><span>メールアドレス</span><input className="input" type="email" required value={f.email} onChange={set('email')} autoComplete="email" /></label>
          <label className="field"><span>パスワード</span><input className="input" type="password" required minLength={signup ? 10 : 1} value={f.password} onChange={set('password')} autoComplete={signup ? 'new-password' : 'current-password'} /></label>
          {err && <div className="alert alert-danger" role="alert">{err}</div>}
          <button className="btn btn-primary btn-block" disabled={busy}>{busy ? '処理中…' : signup ? '登録してはじめる' : 'ログイン'}</button>
          <div className="small muted" style={{ textAlign: 'center' }}>{signup ? <Link to="/login">ログインはこちら</Link> : <Link to="/signup">新規登録</Link>}</div>
        </form>
        <p className="tiny muted" style={{ textAlign: 'center', marginTop: 16 }}>クライアントの方は、担当者から届いたリンクを開いてください（アカウント不要）。</p>
      </div>
    </div>
  )
}
