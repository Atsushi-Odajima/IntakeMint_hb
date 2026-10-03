import type { Db } from '../db'
import type { Config } from '../config'
import type { ObjectStorage } from '../storage'
import type { Scanner } from '../storage/scanner'
import type { EmailProvider } from '../email'
import type { AiProvider } from '../ai/providers'
import type { Role } from '../../shared/types'

export interface Ctx {
  db: Db
  config: Config
  storage: ObjectStorage
  scanner: Scanner
  email: EmailProvider
  ai: { local: AiProvider; external?: AiProvider }
  now: () => Date
}

export interface Actor {
  type: 'user' | 'client' | 'system' | 'mcp'
  orgId: string
  userId?: string
  role?: Role
  /** client actors are bound to exactly one case */
  caseId?: string
  ip?: string
}

export class HttpError extends Error {
  constructor(public status: number, message: string, public code = 'error', public details?: unknown) { super(message) }
}
export const notFound = (what = 'リソース') => new HttpError(404, `${what}が見つかりません`, 'not_found')
export const forbidden = (msg = '権限がありません') => new HttpError(403, msg, 'forbidden')
export const badRequest = (msg: string, details?: unknown) => new HttpError(400, msg, 'bad_request', details)
export const conflict = (msg: string, details?: unknown) => new HttpError(409, msg, 'conflict', details)
