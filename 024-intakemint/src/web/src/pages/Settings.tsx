import { useState } from 'react'
import { api, fmtDateTime } from '../api'
import { useAsync, useToast } from '../components/ui'
import { can, useMe } from '../App'

export default function Settings() {
  const { me, reload } = useMe()
  const toast = useToast()
  const [tab, setTab] = useState('org')
  const s = me!.settings
  const [f, setF] = useState({ senderName: s.branding.senderName, color: s.branding.color, intro: s.branding.intro ?? '', completionMessage: s.branding.completionMessage ?? '', timezone: s.timezone, retentionDays: s.retentionDays })
  const canOrg = can(me, 'org.manage')
  const save = async (patch: any, msg = '保存しました') => { try { await api('/api/org/settings', { method: 'PATCH', body: patch }); await reload(); toast(msg) } catch (e: any) { toast(e.message) } }
  const onLogo = async (file?: File) => {
    if (!file) return
    if (file.size > 200 * 1024) { toast('ロゴは200KB以下にしてください'); return }
    const url = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(file) })
    await save({ branding: { logoDataUrl: url } }, 'ロゴを更新しました')
  }
  const tabs = [['org', 'ブランド・組織'], ['ai', 'AIとプライバシー'], ['members', 'メンバー'], ['mcp', 'MCP / API'], ['data', 'バックアップ・エクスポート'], ['outbox', 'メール送信履歴'], ['audit', '監査ログ']]
  return (
    <div>
      <h1>設定</h1>
      <div className="tabs">{tabs.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === 'org' && (
        <section className="card stack">
          <h2>クライアントに表示するブランド</h2>
          <div className="row">{s.branding.logoDataUrl ? <img src={s.branding.logoDataUrl} alt="ロゴ" style={{ height: 40 }} /> : <span className="muted small">ロゴ未設定</span>}
            {canOrg && <label className="btn btn-sm">ロゴを選択<input type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={(e) => onLogo(e.target.files?.[0])} /></label>}</div>
          <div className="grid grid-2">
            <label className="field"><span>送信者名（メール・ポータルに表示）</span><input className="input" disabled={!canOrg} value={f.senderName} onChange={(e) => setF({ ...f, senderName: e.target.value })} /></label>
            <label className="field"><span>ブランドカラー</span><input className="input" type="color" disabled={!canOrg} value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} style={{ maxWidth: 120, padding: 4 }} /></label>
          </div>
          <label className="field"><span>ポータル冒頭の案内文</span><textarea className="input" disabled={!canOrg} value={f.intro} onChange={(e) => setF({ ...f, intro: e.target.value })} /></label>
          <label className="field"><span>提出完了メッセージ</span><textarea className="input" disabled={!canOrg} value={f.completionMessage} onChange={(e) => setF({ ...f, completionMessage: e.target.value })} /></label>
          <div className="grid grid-2">
            <label className="field"><span>タイムゾーン（リマインド・深夜帯判定）</span><input className="input" disabled={!canOrg} value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })} /></label>
            <label className="field"><span>アーカイブ済み案件の保存期間（日）</span><input className="input" type="number" min={30} max={3650} disabled={!canOrg} value={f.retentionDays} onChange={(e) => setF({ ...f, retentionDays: Number(e.target.value) })} /></label>
          </div>
          {canOrg && <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} onClick={() => save({ timezone: f.timezone, retentionDays: f.retentionDays, branding: { senderName: f.senderName, color: f.color, intro: f.intro, completionMessage: f.completionMessage } })}>保存</button>}
          <p className="tiny muted">完全なホワイトラベル（独自ドメイン・IntakeMint表記の非表示）はPro版候補です。</p>
        </section>
      )}
      {tab === 'ai' && (
        <section className="card stack">
          <h2>AIとプライバシー</h2>
          <label className="check"><input type="checkbox" checked={s.aiEnabled} disabled={!canOrg} onChange={(e) => save({ aiEnabled: e.target.checked }, e.target.checked ? 'AIをONにしました' : 'AIをOFFにしました（AI用インデックスを削除）')} /><span>組織全体でAI機能を使う<div className="help">OFFにすると、すべての案件でAIプロバイダへの呼び出しが0になり、AI用の抽出テキストも削除されます。案件ごと・ファイルごとにもOFFにできます。</div></span></label>
          <label className="check"><input type="checkbox" checked={!!s.allowUrlTitleFetch} disabled={!canOrg} onChange={(e) => save({ allowUrlTitleFetch: e.target.checked })} /><span>参考サイトURLのタイトル取得を許可する（既定OFF）<div className="help">外部URLへサーバーからアクセスします。社内ネットワーク・メタデータアドレスへのアクセスは常に拒否されます（SSRF対策）。</div></span></label>
          <AiUsage />
          <div className="alert alert-info small">初期設定のAIは「ローカル判定（外部送信なし）」です。外部AI（Anthropic等）への送信は、運用者がサーバー設定（AI_ALLOW_EXTERNAL）で明示的に許可した場合のみ行われます。回答本文を分析ツール（Analytics）に流用することはありません。</div>
        </section>
      )}
      {tab === 'members' && <Members />}
      {tab === 'mcp' && <Tokens />}
      {tab === 'data' && (
        <section className="card stack">
          <h2>バックアップ・エクスポート</h2>
          <p className="small">組織の全データ（テンプレート・案件・回答・ファイル・レビュー・リマインド・パック・監査ログ）をZIPでダウンロードします。schemaVersion・appVersion・チェックサム付き。空の環境へ復元できます（<span className="mono">npm run restore -- backup.zip</span>）。</p>
          {can(me, 'export') ? <a className="btn btn-primary" style={{ alignSelf: 'flex-start' }} href="/api/org/export">全データをエクスポート</a> : <div className="alert alert-warn small">エクスポートには Owner / Admin 権限が必要です。</div>}
          <p className="tiny muted">ZIPには個人情報・業務資料が含まれます。暗号化されたストレージで保管してください。</p>
        </section>
      )}
      {tab === 'outbox' && <Outbox />}
      {tab === 'audit' && <Audit />}
    </div>
  )
}

function AiUsage() {
  const { data } = useAsync(() => api<any[]>('/api/org/ai-usage'))
  return (
    <div>
      <h3>AI呼び出し履歴（集計）</h3>
      {!data?.length ? <div className="small muted">呼び出しはまだありません</div> : <table className="table"><thead><tr><th>プロバイダ</th><th>外部送信</th><th>用途</th><th>回数</th><th>文字数</th></tr></thead><tbody>{data.map((r, i) => <tr key={i}><td>{r.provider}</td><td>{r.external ? 'あり' : 'なし'}</td><td>{r.purpose}</td><td>{r.calls}</td><td>{r.chars}</td></tr>)}</tbody></table>}
    </div>
  )
}

function Members() {
  const { me } = useMe()
  const toast = useToast()
  const { data, reload } = useAsync(() => api<any[]>('/api/org/members'))
  const [f, setF] = useState({ email: '', name: '', role: 'editor', password: '' })
  const canM = can(me, 'members.manage')
  return (
    <section className="card">
      <h2>メンバーと権限</h2>
      <div className="table-wrap"><table className="table"><thead><tr><th>名前</th><th>メール</th><th>ロール</th><th></th></tr></thead><tbody>
        {data?.map((m) => <tr key={m.id}><td>{m.name}</td><td>{m.email}</td><td>
          <select className="input" style={{ maxWidth: 140, minHeight: 34, padding: 4 }} disabled={!canM || m.id === me!.user.id} value={m.role} onChange={async (e) => { try { await api(`/api/org/members/${m.id}`, { method: 'PATCH', body: { role: e.target.value } }); toast('変更しました'); reload() } catch (x: any) { toast(x.message) } }}>
            {['owner', 'admin', 'manager', 'editor', 'viewer'].map((r) => <option key={r}>{r}</option>)}</select></td>
          <td>{canM && m.id !== me!.user.id && <button className="btn btn-sm btn-ghost" onClick={async () => { if (confirm('メンバーを外しますか？')) { try { await api(`/api/org/members/${m.id}`, { method: 'DELETE' }); reload() } catch (x: any) { toast(x.message) } } }}>削除</button>}</td></tr>)}
      </tbody></table></div>
      <p className="tiny muted">Owner：全権限／Admin：組織管理・メンバー管理／Manager：公開・Ready上書き・リマインド送信／Editor：案件・フォーム編集・レビュー／Viewer：閲覧のみ。クライアントは内部ユーザーとは別で、共有リンクの案件にだけアクセスできます。</p>
      {canM && (
        <form className="grid grid-2" style={{ marginTop: 12 }} onSubmit={async (e) => { e.preventDefault(); try { await api('/api/org/members', { body: { ...f, password: f.password || undefined } }); toast('追加しました'); setF({ email: '', name: '', role: 'editor', password: '' }); reload() } catch (x: any) { toast(x.message) } }}>
          <input className="input" placeholder="名前" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} aria-label="名前" />
          <input className="input" type="email" placeholder="メール" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} aria-label="メール" />
          <select className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} aria-label="ロール">{['admin', 'manager', 'editor', 'viewer'].map((r) => <option key={r}>{r}</option>)}</select>
          <input className="input" type="password" placeholder="初期パスワード（新規ユーザーのみ・10文字以上）" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} aria-label="初期パスワード" />
          <button className="btn btn-primary">メンバーを追加</button>
        </form>
      )}
    </section>
  )
}

function Tokens() {
  const toast = useToast()
  const { me } = useMe()
  const { data, reload } = useAsync(() => (can(me, 'token.manage') ? api<any[]>('/api/org/tokens') : Promise.resolve([])))
  const [created, setCreated] = useState<string | null>(null)
  return (
    <section className="card stack">
      <h2>MCP / APIトークン</h2>
      <p className="small">Claude Code・ChatGPT等のMCPクライアントから「この案件開始できる？」「不足項目は？」を確認したり、案件開始パックを生成できます。書き込み操作は confirm:true（人間の確認）が必要で、メール送信やクライアントへの連絡は行いません。</p>
      {!can(me, 'token.manage') ? <div className="alert alert-warn small">トークン管理には Owner / Admin 権限が必要です。</div> : <>
        <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} onClick={async () => { const name = prompt('トークン名（例：claude-code）'); if (!name) return; const r = await api('/api/org/tokens', { body: { name } }); setCreated(r.token); reload() }}>トークンを発行</button>
        {created && <div className="alert alert-ok small">このトークンは一度だけ表示されます：<input className="input mono" readOnly value={created} onFocus={(e) => e.target.select()} aria-label="トークン" /><div className="mono tiny" style={{ marginTop: 6 }}>{`claude mcp add intakemint --env INTAKEMINT_API_TOKEN=${created.slice(0, 8)}… -- npm --prefix /path/to/024-intakemint run mcp`}</div></div>}
        <table className="table"><thead><tr><th>名前</th><th>作成</th><th>最終利用</th><th></th></tr></thead><tbody>
          {data?.map((t) => <tr key={t.id}><td>{t.name}</td><td>{fmtDateTime(t.created_at)}</td><td>{fmtDateTime(t.last_used_at)}</td><td>{t.revoked_at ? <span className="badge b-draft">失効</span> : <button className="btn btn-sm btn-danger" onClick={async () => { await api(`/api/org/tokens/${t.id}`, { method: 'DELETE' }); toast('失効しました'); reload() }}>失効</button>}</td></tr>)}
        </tbody></table>
      </>}
    </section>
  )
}

function Outbox() {
  const { data, error } = useAsync(() => api<any[]>('/api/org/outbox'))
  return (
    <section className="card">
      <h2>メール送信履歴</h2>
      {error && <div className="alert alert-warn small">{error}</div>}
      <p className="small muted">初期設定のメールプロバイダは「ローカル記録（outbox-local）」で、実際のメールは送信されません。実送信は運用者がプロバイダを設定・承認した場合のみです。</p>
      <div className="table-wrap"><table className="table"><thead><tr><th>宛先</th><th>件名</th><th>状態</th><th>試行</th><th>プロバイダ</th><th>作成</th></tr></thead><tbody>
        {data?.map((m) => <tr key={m.id}><td>{m.to_address}</td><td>{m.subject}</td><td><span className={`badge b-${m.status === 'sent' ? 'accepted' : m.status === 'failed' ? 'missing' : 'draft'}`}>{m.status}</span>{m.last_error && <div className="tiny" style={{ color: 'var(--danger)' }}>{m.last_error}</div>}</td><td>{m.attempts}</td><td>{m.provider}</td><td className="small">{fmtDateTime(m.created_at)}</td></tr>)}
      </tbody></table></div>
    </section>
  )
}

function Audit() {
  const { data, error } = useAsync(() => api<any[]>('/api/org/audit?limit=200'))
  return (
    <section className="card">
      <h2>監査ログ</h2>
      {error && <div className="alert alert-warn small">{error}</div>}
      <div className="table-wrap"><table className="table"><thead><tr><th>日時</th><th>操作</th><th>実行者</th><th>対象</th><th>詳細</th></tr></thead><tbody>
        {data?.map((a) => <tr key={a.id}><td className="small">{fmtDateTime(a.created_at)}</td><td className="mono">{a.action}</td><td className="small">{a.actor_type}</td><td className="small mono">{a.target_type}:{String(a.target_id ?? '').slice(0, 8)}</td><td className="tiny mono">{JSON.stringify(a.meta).slice(0, 120)}</td></tr>)}
      </tbody></table></div>
    </section>
  )
}
