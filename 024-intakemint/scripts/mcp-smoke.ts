// MCP stdio smoke test: seeds a fresh DB, issues an API token, spawns `npm run mcp` and talks to it with the official SDK client.
// DATABASE_URL=postgres://... npx tsx scripts/mcp-smoke.ts   (uses a fresh schema — do not point at production)
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { createPostgresDb, migrate } from '../src/server/db'
import { createCtx } from '../src/server/ctx'
import { seedSample } from '../src/server/seed'
import { createApiToken } from '../src/server/services/orgs'

const url = process.env.DATABASE_URL!
const db = await createPostgresDb(url)
await db.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
await migrate(db)
const ctx = await createCtx({ db, config: { storageDir: './data/mcp-smoke-objects' } })
const seed = await seedSample(ctx)
const owner = await db.one(`SELECT user_id FROM memberships WHERE org_id=$1`, [seed.orgId])
const { token } = await createApiToken(ctx, { type: 'user', orgId: seed.orgId!, userId: owner.user_id, role: 'owner' }, 'smoke')
await db.close()

const transport = new StdioClientTransport({ command: 'npx', args: ['tsx', 'src/mcp/server.ts'], env: { ...process.env, INTAKEMINT_API_TOKEN: token, DATABASE_URL: url, STORAGE_DIR: './data/mcp-smoke-objects' } as Record<string, string> })
const client = new Client({ name: 'smoke', version: '1.0.0' })
await client.connect(transport)
const tools = await client.listTools()
console.log('tools:', tools.tools.map((t) => t.name).join(', '))
const call = async (name: string, args: any) => JSON.parse(((await client.callTool({ name, arguments: args })) as any).content[0].text)
const st = await call('get_intake_status', { caseId: seed.caseIds!.inProgress })
console.log('canStart:', st.canStart, '|', st.progress.text, '|', st.blockingReasons.join(' / '))
const pv = await call('request_more_information', { caseId: seed.caseIds!.inProgress, text: 'ロゴのAIデータはありますか？' })
console.log('write without confirm -> requiresConfirmation:', pv.requiresConfirmation)
const ready = await call('get_ready_cases', {})
console.log('ready cases:', ready.map((r: any) => r.project).join(', '))
const h = await call('prepare_handoff', { caseId: seed.caseIds!.ready, profile: 'web_development' })
console.log('handoff ready:', h.ready, 'has acceptance criteria:', h.markdown.includes('Acceptance Criteria'))
await client.close()
