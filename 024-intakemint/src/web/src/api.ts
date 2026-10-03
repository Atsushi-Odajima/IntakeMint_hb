// Small fetch wrapper: same-origin, cookie session, CSRF header for state-changing calls.
let csrf = ''
export const setCsrf = (t: string) => { csrf = t }

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string, public details?: unknown) { super(message) }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const method = opts.method ?? (opts.body !== undefined || opts.form ? 'POST' : 'GET')
  const headers: Record<string, string> = {}
  if (method !== 'GET' && csrf) headers['x-csrf-token'] = csrf
  if (opts.body !== undefined) headers['content-type'] = 'application/json'
  const res = await fetch(path, { method, headers, credentials: 'same-origin', body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined) })
  const ct = res.headers.get('content-type') ?? ''
  const data = ct.includes('application/json') ? await res.json() : await res.text()
  if (!res.ok) {
    const msg = typeof data === 'object' && data?.error ? data.error : `エラーが発生しました（${res.status}）`
    if (res.status === 401 && !path.startsWith('/api/portal') && !path.startsWith('/api/auth') && location.pathname.startsWith('/app')) location.href = '/login'
    throw new ApiError(res.status, msg, data?.code, data?.details)
  }
  return data as T
}

export const fmtDate = (s?: string | null) => (s ? String(s).slice(0, 10) : '—')
export const fmtDateTime = (s?: string | null) => {
  if (!s) return '—'
  const d = new Date(s)
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
export const fmtSize = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.ceil(n / 1024)}KB`)
