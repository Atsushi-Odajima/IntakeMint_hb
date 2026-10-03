# INTAKE_ENGINE — 全体フロー

```
案件作成 → 必要情報/必要ファイル定義（Template vN） → Client共有（期限付きリンク）
 → 回答（自動保存・後で続き） → 条件分岐（表示/必須化） → AI不足検出（候補）
 → 追加質問（人間が承認してポータルに表示） → ファイル提出（検証・原本保持）
 → 充足判定（決定的） → Reminder（未提出のみ・下書き→承認） → 内部Review
 → Ready判定（サインオフ / 理由付きoverride） → Intake Package / Project Brief
 → Handoff（Claude Code・制作担当・業務担当、MCP）
```

## コンポーネント
| 層 | 場所 | 役割 |
|---|---|---|
| Shared engine | `src/shared/` | 型・条件分岐・バリデーション・充足判定・サンプルテンプレート（ブラウザ/サーバー共通） |
| Services | `src/server/services/` | templates / cases（recompute）/ access / intake / review / ai / reminders / packages / search / backup / orgs / rbac / audit / notifications |
| HTTP API | `src/server/app.ts` | Fastify。認証・CSRF・RBAC・レート制限・CSP・Signed URL |
| Jobs | `src/server/jobs/` | DBキュー：AI分析・メール送信（リトライ）・リマインドスキャン・保存期間パージ |
| Adapters | `storage/`, `email/`, `ai/`, `connectors/` | Local/S3、outbox/Resend、ローカル判定/Anthropic、Connector interface |
| Web | `src/web/` | React PWA：内部アプリ（/app）・クライアントポータル（/p/:token） |
| MCP | `src/mcp/` | stdio MCPサーバー（同じサービス層・RBAC） |

## recompute（中心処理）
回答保存・ファイル提出/レビュー・候補処理・追加質問・サインオフ・overrideのたびに `cases.recompute()` が：
1. 状態をロード（固定バージョンの定義・回答・ファイル・項目レビュー・未解決AI件数）
2. 必須情報変更ならサインオフ/override を無効化
3. 充足判定 → ステータス・進捗・「足りないもの」要約・ready_at を更新
4. Ready 到達/解除を監査・通知、検索インデックス更新

## Template version
Published を直接上書きしない。公開ごとに `template_versions` に新行（不変）。案件は作成時のバージョンを保持し、以後の公開は既存案件に反映しない（テスト #20）。
