// Object storage abstraction. Local filesystem (single node / dev) and S3-compatible (S3 / R2 / MinIO) adapters.
// Original files are written once and never modified (source of truth). Derived data lives in the DB.
import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { resolveInside } from '../security/paths'

export interface ObjectStorage {
  readonly name: string
  put(key: string, data: Buffer, contentType: string): Promise<void>
  get(key: string): Promise<Buffer | null>
  delete(key: string): Promise<void>
  deletePrefix(prefix: string): Promise<void>
}

const KEY_RE = /^[A-Za-z0-9/_\-.]+$/

export class LocalStorage implements ObjectStorage {
  readonly name = 'local-fs'
  constructor(private root: string) {}
  private p(key: string): string {
    if (!KEY_RE.test(key) || key.includes('..')) throw new Error('invalid storage key')
    const abs = resolveInside(this.root, key)
    if (!abs) throw new Error('invalid storage key')
    return abs
  }
  async put(key: string, data: Buffer) {
    const file = this.p(key)
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, data, { flag: 'wx' }) // never overwrite an original
  }
  async get(key: string) { try { return await fs.readFile(this.p(key)) } catch { return null } }
  async delete(key: string) { await fs.rm(this.p(key), { force: true }) }
  async deletePrefix(prefix: string) { await fs.rm(this.p(prefix), { recursive: true, force: true }) }
}

/** Minimal S3-compatible adapter (AWS SigV4). Configure with S3_ENDPOINT, S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY.
 *  NOTE: not exercised against a real bucket in this repository's tests (see TEST_REPORT.md). */
export class S3Storage implements ObjectStorage {
  readonly name = 's3'
  constructor(private o: { endpoint: string; bucket: string; region: string; accessKeyId: string; secretAccessKey: string }) {}
  private async req(method: string, key: string, body?: Buffer, contentType?: string, query = ''): Promise<Response> {
    const url = new URL(`${this.o.endpoint.replace(/\/$/, '')}/${this.o.bucket}/${key.split('/').map(encodeURIComponent).join('/')}${query}`)
    const now = new Date(); const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ''); const day = amzDate.slice(0, 8)
    const payloadHash = crypto.createHash('sha256').update(body ?? Buffer.alloc(0)).digest('hex')
    const headers: Record<string, string> = { host: url.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate }
    if (contentType) headers['content-type'] = contentType
    const signed = Object.keys(headers).sort()
    const canonQuery = [...url.searchParams.entries()].sort().map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
    const canon = [method, url.pathname, canonQuery, signed.map((h) => `${h}:${headers[h]}\n`).join(''), signed.join(';'), payloadHash].join('\n')
    const scope = `${day}/${this.o.region}/s3/aws4_request`
    const sts = ['AWS4-HMAC-SHA256', amzDate, scope, crypto.createHash('sha256').update(canon).digest('hex')].join('\n')
    const h = (k: Buffer | string, d: string) => crypto.createHmac('sha256', k).update(d).digest()
    const kSig = h(h(h(h('AWS4' + this.o.secretAccessKey, day), this.o.region), 's3'), 'aws4_request')
    const sig = crypto.createHmac('sha256', kSig).update(sts).digest('hex')
    headers.authorization = `AWS4-HMAC-SHA256 Credential=${this.o.accessKeyId}/${scope}, SignedHeaders=${signed.join(';')}, Signature=${sig}`
    delete headers.host
    return fetch(url, { method, headers, body: body ? new Uint8Array(body) : undefined })
  }
  async put(key: string, data: Buffer, contentType: string) { const r = await this.req('PUT', key, data, contentType); if (!r.ok) throw new Error(`S3 put failed ${r.status}`) }
  async get(key: string) { const r = await this.req('GET', key); return r.ok ? Buffer.from(await r.arrayBuffer()) : null }
  async delete(key: string) { await this.req('DELETE', key) }
  async deletePrefix(_prefix: string) { throw new Error('S3 deletePrefix: use bucket lifecycle / list+delete (not implemented in foundation)') }
}

export function createStorage(dir: string): ObjectStorage {
  if (process.env.S3_BUCKET) {
    return new S3Storage({
      endpoint: process.env.S3_ENDPOINT ?? `https://s3.${process.env.S3_REGION ?? 'us-east-1'}.amazonaws.com`,
      bucket: process.env.S3_BUCKET, region: process.env.S3_REGION ?? 'auto',
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '', secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
    })
  }
  return new LocalStorage(dir)
}
