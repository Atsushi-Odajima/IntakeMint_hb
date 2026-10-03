// IntakeMint MCP server (stdio). Auth: INTAKEMINT_API_TOKEN (org-scoped API token created in Settings).
// Uses the same service layer / RBAC / tenant isolation as the web app. Write tools require confirm:true.
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { createCtx } from '../server/ctx'
import { resolveApiToken } from '../server/services/orgs'
import { TOOLS, callTool } from './tools'
import type { Ctx } from '../server/services/context'

export function createMcpServer(ctx: Ctx, token: string) {
  const server = new Server({ name: 'intakemint', version: ctx.config.appVersion }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({
      name: t.name, description: t.description + (t.write ? '【書き込み：confirm:true が必要】' : ''),
      inputSchema: z.toJSONSchema(t.input) as any,
      annotations: { readOnlyHint: !t.write, destructiveHint: false, openWorldHint: false },
    })),
  }))
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const actor = await resolveApiToken(ctx.db, token)
    if (!actor) return { isError: true, content: [{ type: 'text', text: 'APIトークンが無効です' }] }
    try {
      const out = await callTool(ctx, actor, req.params.name, req.params.arguments)
      return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] }
    } catch (e) {
      return { isError: true, content: [{ type: 'text', text: (e as Error).message }] }
    }
  })
  return server
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const token = process.env.INTAKEMINT_API_TOKEN
  if (!token) { console.error('INTAKEMINT_API_TOKEN is required'); process.exit(1) }
  const ctx = await createCtx()
  await createMcpServer(ctx, token).connect(new StdioServerTransport())
}
