// Runtime configuration from environment variables. Secrets are never hard-coded (see .env.example).
import crypto from 'node:crypto'

export interface Config {
  env: 'development' | 'test' | 'production'
  port: number
  publicBaseUrl: string
  /** HMAC secret for signed file URLs */
  signingSecret: string
  storageDir: string
  sessionTtlHours: number
  clientLinkDefaultDays: number
  signedUrlTtlSeconds: number
  ai: { provider: 'local' | 'anthropic' | 'openai'; apiKey?: string; model?: string; allowExternal: boolean }
  email: { provider: 'outbox' | 'resend'; apiKey?: string; from: string; allowRealSend: boolean }
  scanner: 'none' | 'clamav'
  clamavHost?: string
  appVersion: string
  maxUploadMB: number
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const env = (process.env.NODE_ENV as Config['env']) || 'development'
  const secret = process.env.SIGNING_SECRET
  if (env === 'production' && (!secret || secret.length < 32)) throw new Error('SIGNING_SECRET (32+ chars) is required in production')
  return {
    env,
    port: Number(process.env.PORT ?? 8787),
    publicBaseUrl: process.env.PUBLIC_BASE_URL ?? 'http://localhost:8787',
    signingSecret: secret ?? crypto.randomBytes(32).toString('hex'),
    storageDir: process.env.STORAGE_DIR ?? './data/objects',
    sessionTtlHours: Number(process.env.SESSION_TTL_HOURS ?? 24 * 7),
    clientLinkDefaultDays: Number(process.env.CLIENT_LINK_DAYS ?? 14),
    signedUrlTtlSeconds: Number(process.env.SIGNED_URL_TTL ?? 300),
    ai: {
      provider: (process.env.AI_PROVIDER as Config['ai']['provider']) ?? 'local',
      apiKey: process.env.AI_API_KEY,
      model: process.env.AI_MODEL,
      // External AI calls with client data require an explicit opt-in by the operator.
      allowExternal: process.env.AI_ALLOW_EXTERNAL === 'true',
    },
    email: {
      provider: (process.env.EMAIL_PROVIDER as Config['email']['provider']) ?? 'outbox',
      apiKey: process.env.EMAIL_API_KEY,
      from: process.env.EMAIL_FROM ?? 'no-reply@example.invalid',
      allowRealSend: process.env.EMAIL_ALLOW_REAL_SEND === 'true',
    },
    scanner: (process.env.SCANNER as Config['scanner']) ?? 'none',
    clamavHost: process.env.CLAMAV_HOST,
    appVersion: process.env.APP_VERSION ?? '0.1.0',
    maxUploadMB: Number(process.env.MAX_UPLOAD_MB ?? 50),
    ...overrides,
  }
}
