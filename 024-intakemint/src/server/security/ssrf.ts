// SSRF guard for optional URL ingestion (e.g. fetching a reference site's title).
// Only http/https on default ports, DNS-resolved addresses must be public, no redirects to private ranges.
import dns from 'node:dns/promises'
import net from 'node:net'

export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number)
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224 || (a === 198 && (b === 18 || b === 19))
  }
  const v = ip.toLowerCase()
  if (v === '::1' || v === '::') return true
  if (v.startsWith('::ffff:')) return isPrivateIp(v.slice(7))
  return v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('ff')
}

export async function assertPublicUrl(raw: string, lookup: (h: string) => Promise<string[]> = async (h) => (await dns.lookup(h, { all: true })).map((x) => x.address)): Promise<URL> {
  let u: URL
  try { u = new URL(raw) } catch { throw new Error('URLの形式が正しくありません') }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('http/https以外は取得できません')
  if (u.username || u.password) throw new Error('認証情報付きURLは取得できません')
  if (u.port && !['80', '443'].includes(u.port)) throw new Error('標準ポート以外は取得できません')
  const host = u.hostname.replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) throw new Error('内部ホストは取得できません')
  const addrs = net.isIP(host) ? [host] : await lookup(host)
  if (!addrs.length || addrs.some(isPrivateIp)) throw new Error('内部ネットワークのアドレスは取得できません')
  return u
}

/** Fetch page title with SSRF guard, manual redirect checks, 5s timeout and 512KB cap. Disabled unless explicitly enabled. */
export async function fetchTitle(raw: string, maxRedirects = 3): Promise<string | null> {
  let url = await assertPublicUrl(raw)
  for (let i = 0; i <= maxRedirects; i++) {
    const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(5000), headers: { 'user-agent': 'IntakeMint-RefBot/0.1' } })
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = await assertPublicUrl(new URL(res.headers.get('location')!, url).toString()); continue
    }
    const reader = res.body?.getReader(); if (!reader) return null
    let got = 0; const chunks: Uint8Array[] = []
    while (got < 512 * 1024) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); got += value.length }
    reader.cancel().catch(() => {})
    const html = Buffer.concat(chunks).toString('utf8')
    const m = /<title[^>]*>([^<]{0,300})<\/title>/i.exec(html)
    return m ? m[1].trim() : null
  }
  return null
}
