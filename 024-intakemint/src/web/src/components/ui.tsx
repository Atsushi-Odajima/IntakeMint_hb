import React, { createContext, useContext, useEffect, useState } from 'react'
import { STATUS_LABEL, CASE_STATUS_LABEL } from '../../../shared/completeness'

export function Logo({ size = 28, withText = true, sub = false }: { size?: number; withText?: boolean; sub?: boolean }) {
  return (
    <span className="row" style={{ gap: 8, flexWrap: 'nowrap' }} aria-label="IntakeMint">
      <img src="/logo-mark.svg" width={size} height={size} alt="" />
      {withText && (
        <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
          <span style={{ fontWeight: 700, fontSize: size * 0.72, letterSpacing: '-0.01em', color: 'var(--forest)' }}>Intake<span style={{ color: 'var(--mint-ink)' }}>Mint</span></span>
          {sub && <span style={{ fontSize: 7.5, letterSpacing: '0.14em', color: 'var(--muted)', marginTop: 4, whiteSpace: 'nowrap' }}>SMART INTAKE FOR REAL WORK</span>}
        </span>
      )}
    </span>
  )
}

export function ItemBadge({ status }: { status: string }) {
  return <span className={`badge b-${status}`}>{STATUS_LABEL[status as keyof typeof STATUS_LABEL] ?? status}</span>
}
export function CaseBadge({ status }: { status: string }) {
  return <span className={`badge b-${status}`}>{CASE_STATUS_LABEL[status] ?? status}</span>
}

export function Progress({ value, lg, label }: { value: number; lg?: boolean; label?: string }) {
  return (
    <div className={`progress ${lg ? 'lg' : ''}`} role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100} aria-label={label ?? '進捗'}>
      <div style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  )
}

export function StatusDot({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    accepted: ['ok', '✓'], submitted: ['wait', '…'], needs_review: ['part', '!'], partial: ['part', '◐'], missing: ['ng', '×'], rejected: ['ng', '↺'], not_applicable: ['na', '–'],
  }
  const [cls, ch] = map[status] ?? ['na', '·']
  return <span className={`dot ${cls}`} aria-hidden>{ch}</span>
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="row between" style={{ marginBottom: 12 }}><h2 style={{ margin: 0 }}>{title}</h2><button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="閉じる">✕</button></div>
        {children}
      </div>
    </div>
  )
}

const ToastCtx = createContext<(m: string) => void>(() => {})
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null)
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(null), 3200); return () => clearTimeout(t) }, [msg])
  return <ToastCtx.Provider value={setMsg}>{children}{msg && <div className="toast" role="status">{msg}</div>}</ToastCtx.Provider>
}
export const useToast = () => useContext(ToastCtx)

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let live = true
    setLoading(true)
    fn().then((d) => { if (live) { setData(d); setError(null) } }).catch((e) => live && setError(e.message)).finally(() => live && setLoading(false))
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])
  return { data, error, loading, reload: () => setTick((x) => x + 1), setData }
}

export const Icon = {
  home: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>,
  cases: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><rect x="3" y="5" width="18" height="15" rx="2"/><path d="M8 5V3h8v2M3 11h18"/></svg>,
  form: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>,
  search: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>,
  gear: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>,
  bell: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21h4"/></svg>,
  upload: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><path d="M12 16V4M7 9l5-5 5 5M4 20h16"/></svg>,
}
