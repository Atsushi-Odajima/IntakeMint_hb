import { openDb, type Db } from './db'
import { loadConfig, type Config } from './config'
import { createStorage, type ObjectStorage } from './storage'
import { BasicScanner, ClamAvScanner } from './storage/scanner'
import { OutboxProvider, ResendProvider, type EmailProvider } from './email'
import { AnthropicProvider, LocalHeuristicProvider, type AiProvider } from './ai/providers'
import type { Ctx } from './services/context'

export async function createCtx(o: { db?: Db; config?: Partial<Config>; storage?: ObjectStorage; email?: EmailProvider; externalAi?: AiProvider; now?: () => Date } = {}): Promise<Ctx> {
  const config = loadConfig(o.config)
  const db = o.db ?? (await openDb())
  let email: EmailProvider = o.email ?? new OutboxProvider()
  if (!o.email && config.email.provider === 'resend' && config.email.allowRealSend && config.email.apiKey) email = new ResendProvider(config.email.apiKey, config.email.from)
  let external = o.externalAi
  if (!external && config.ai.provider === 'anthropic' && config.ai.apiKey) external = new AnthropicProvider(config.ai.apiKey, config.ai.model)
  return {
    db, config,
    storage: o.storage ?? createStorage(config.storageDir),
    scanner: config.scanner === 'clamav' && config.clamavHost ? new ClamAvScanner(config.clamavHost) : new BasicScanner(),
    email,
    ai: { local: new LocalHeuristicProvider(), external },
    now: o.now ?? (() => new Date()),
  }
}
