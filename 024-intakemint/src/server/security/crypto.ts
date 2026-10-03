import crypto from 'node:crypto'

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url')
export const sha256 = (s: string | Buffer) => crypto.createHash('sha256').update(s).digest('hex')

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16)
  const key = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 })
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`
}

export function verifyPassword(password: string, stored: string | null): boolean {
  if (!stored) return false
  const [alg, saltB64, keyB64] = stored.split('$')
  if (alg !== 'scrypt' || !saltB64 || !keyB64) return false
  const key = Buffer.from(keyB64, 'base64')
  const test = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), key.length, { N: 16384, r: 8, p: 1 })
  return crypto.timingSafeEqual(key, test)
}

export function hmac(secret: string, data: string): string {
  return crypto.createHmac('sha256', secret).update(data).digest('base64url')
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a), bb = Buffer.from(b)
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb)
}

/** Signed, expiring object URL: /api/files/signed?k=<key>&e=<unix>&s=<hmac>. Expired or tampered => 403. */
export function signObjectUrl(secret: string, key: string, ttlSeconds: number, now = Date.now(), disposition: 'inline' | 'attachment' = 'attachment'): string {
  const e = Math.floor(now / 1000) + ttlSeconds
  const s = hmac(secret, `${key}\n${e}\n${disposition}`)
  return `/api/files/signed?k=${encodeURIComponent(key)}&e=${e}&d=${disposition}&s=${s}`
}

export function verifySignedUrl(secret: string, key: string, e: number, d: string, s: string, now = Date.now()): 'ok' | 'expired' | 'invalid' {
  if (!key || !Number.isFinite(e) || !s) return 'invalid'
  if (!safeEqual(hmac(secret, `${key}\n${e}\n${d}`), s)) return 'invalid'
  if (Math.floor(now / 1000) > e) return 'expired'
  return 'ok'
}
