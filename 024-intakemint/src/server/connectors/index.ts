// Connector architecture. v1 ships with Upload (client portal) and Export (package / ZIP / CSV) only.
// External connectors (Google Drive, Dropbox, OneDrive, Gmail, Slack, CRM, project tools) are future adapters
// implementing this interface. Every outbound action requires explicit human confirmation and is audited.
export type ConnectorKind = 'import' | 'export' | 'notify'
export interface ConnectorContext { orgId: string; caseId?: string; actorUserId?: string; confirmed: boolean }

export interface ConnectorFile { name: string; mime: string; bytes: Buffer }

export interface Connector {
  readonly id: string
  readonly label: string
  readonly kinds: ConnectorKind[]
  /** OAuth scopes the adapter would need — shown to the admin before connecting (least privilege, e.g. drive.file). */
  readonly scopes: string[]
  readonly status: 'built_in' | 'planned'
  /** Pull files chosen by a human (e.g. Google Picker) into a file item. */
  importFiles?(ctx: ConnectorContext, refs: string[]): Promise<ConnectorFile[]>
  /** Push an intake package (Markdown/JSON) to an external destination. */
  exportPackage?(ctx: ConnectorContext, pkg: { markdown: string; json: unknown; files: { path: string; bytes: Buffer }[] }): Promise<{ externalUrl?: string }>
  /** Send a short notification (never answer bodies). */
  notify?(ctx: ConnectorContext, text: string): Promise<void>
}

export class ConfirmationRequired extends Error { constructor() { super('外部連携の実行には人間の確認が必要です') } }

export function assertConfirmed(ctx: ConnectorContext) { if (!ctx.confirmed) throw new ConfirmationRequired() }

export const CONNECTORS: Connector[] = [
  { id: 'upload', label: 'クライアントポータルからのアップロード', kinds: ['import'], scopes: [], status: 'built_in' },
  { id: 'export', label: 'エクスポート（Markdown / TXT / JSON / CSV / ZIP）', kinds: ['export'], scopes: [], status: 'built_in' },
  { id: 'google_drive', label: 'Google Drive', kinds: ['import', 'export'], scopes: ['https://www.googleapis.com/auth/drive.file'], status: 'planned' },
  { id: 'dropbox', label: 'Dropbox', kinds: ['import', 'export'], scopes: ['files.content.read', 'files.content.write'], status: 'planned' },
  { id: 'onedrive', label: 'OneDrive (Microsoft Graph)', kinds: ['import', 'export'], scopes: ['Files.ReadWrite.AppFolder'], status: 'planned' },
  { id: 'gmail', label: 'Gmail（送信のみ）', kinds: ['notify'], scopes: ['https://www.googleapis.com/auth/gmail.send'], status: 'planned' },
  { id: 'slack', label: 'Slack（社内通知）', kinds: ['notify'], scopes: ['chat:write'], status: 'planned' },
  { id: 'crm', label: 'CRM / Project tools', kinds: ['export'], scopes: [], status: 'planned' },
]
