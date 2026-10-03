# MCP_PLUGIN — MCP server foundation

- 実装：`src/mcp/tools.ts`（トランスポート非依存・テスト可能）、`src/mcp/server.ts`（stdio、`@modelcontextprotocol/sdk` 1.32 MIT の low-level Server）。
- 仕様確認（SOURCE_NOTES.md）：MCP 最新仕様 2026-07-28（ステートレス化）。SDK v2 は `@modelcontextprotocol/server` 等に分割（Apache-2.0）。本実装は v1 系 SDK の stdio を使用し、HTTP（Streamable）化・OAuth は次段階（NEXT_STEPS）。
- 認証：設定 → MCP/API で発行する組織スコープのAPIトークン（`imt_...`、sha256保存、失効可）。トークン所有者のロールで RBAC・テナント分離をそのまま適用（他テナント案件は「見つかりません」）。

## Tools
| tool | 種別 | 内容 |
|---|---|---|
| get_intake_status | read | 「この案件開始できる？」：canStart、必要項目N件中M件、Readyを止めている理由（事実） |
| get_missing_items | read | 未提出/一部提出(3/5)/差戻/確認待ち、未回答の追加質問 |
| get_ready_cases | read | Ready案件一覧 |
| search_intakes | read | 権限内検索 |
| prepare_handoff | read | Handoff Markdownのプレビュー（保存しない、未Readyなら警告） |
| create_intake | write | 案件作成（クライアント送信はしない） |
| review_response | write | 項目の承認/差戻/要確認 |
| request_more_information | write | ポータルへ追加質問を表示（メールは送らない） |
| draft_reminder | write | 未提出項目のリマインド下書き（送信は人間がアプリで承認） |
| generate_intake_package | write | パック生成・保存 |

**write ツールは `confirm: true` がない限りプレビューのみ**を返し、何も変更しない（`requiresConfirmation: true`）。confirm 実行は監査ログ `mcp.<tool>`。MCPからのメール送信・クライアント連絡は不可（テスト #29 / E2E-7）。ツールには `readOnlyHint` 注釈を付与。

## Claude Code への登録例
```
claude mcp add intakemint --env INTAKEMINT_API_TOKEN=imt_xxx --env DATABASE_URL=postgres://... -- npm --prefix /path/to/024-intakemint run mcp
```
MCPサーバーはDBに直接接続するため、サーバーと同じ `DATABASE_URL`（または `PGLITE_DIR`）を指定する。PGliteは単一プロセス専用のため、MCPを併用する場合は PostgreSQL を使う。

## OpenAI / ChatGPT
ChatGPT（Apps SDK / connectors）・Codex は MCP をサポート（SOURCE_NOTES 参照）。リモート接続には HTTP トランスポート＋OAuth が必要なため、Plugin公開は未実施（Pro/次段階）。
