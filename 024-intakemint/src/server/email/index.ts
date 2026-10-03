// Email provider abstraction. Default "outbox" provider records messages locally and NEVER sends real email.
// Real providers require EMAIL_ALLOW_REAL_SEND=true + API key (human approval required before enabling).
export interface EmailMessage { to: string; fromName: string; subject: string; body: string }
export interface EmailProvider { readonly name: string; readonly real: boolean; send(m: EmailMessage): Promise<{ id: string }> }

export class OutboxProvider implements EmailProvider {
  readonly name = 'outbox-local'
  readonly real = false
  /** test hook: force failures */
  failNext = 0
  sent: EmailMessage[] = []
  async send(m: EmailMessage) {
    if (this.failNext > 0) { this.failNext--; throw new Error('simulated provider failure') }
    this.sent.push(m)
    return { id: `local-${Date.now()}-${this.sent.length}` }
  }
}

export class ResendProvider implements EmailProvider {
  readonly name = 'resend'
  readonly real = true
  constructor(private apiKey: string, private from: string) {}
  async send(m: EmailMessage) {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: `${m.fromName} <${this.from}>`, to: [m.to], subject: m.subject, text: m.body }),
      signal: AbortSignal.timeout(10000),
    })
    if (!r.ok) throw new Error(`resend ${r.status}`)
    const j = (await r.json()) as { id: string }
    return { id: j.id }
  }
}
