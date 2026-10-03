# PACKAGE_HANDOFF — 案件開始パック / Handoff

実装：`src/server/services/packages.ts`。生成は決定的（LLMで文章を作らない）。

## 構造（`intakemint.package/v1`）
`meta`（案件・テンプレートvN・プロファイル・status・readyAt・override・進捗）、`sections`：
Client / Project / Objective / Audience / Requirements / Preferences / Assets / References / Constraints / Open Questions / Files / Decisions / Notes、`handoff`。

- 各エントリは `source`（questionId / fileId / itemId / followupId / reviewId）を保持（テスト #18）。Markdownでは `[q:site_goal]` `[file:1a2b3c4d]` と表記。
- 未回答のマッピング質問は `Unknown（未回答）`、未承認の必須項目・未確定の追加質問は **Open Questions**。
- テンプレートにない要件は作らない。マッピング外の回答は Notes へ（落とさない・足さない／テスト #19）。
- 非表示質問の回答は含めない（E2E-3）。
- 出力：JSON / Markdown / TXT、印刷→PDF保存（ブラウザ印刷用CSS）。生成は版管理（v1, v2…）。

## Handoff Profiles
Web Development / Design / Video / SNS Management / Consulting / Recruiting / Accounting Prep / Generic。

### Developer Handoff（web_development）
Overview / **Pages・Features（候補）**（`site_purpose` の選択肢から候補化：会社概要・問い合わせフォーム・商品一覧/カート・採用ページ・ブログ）/ Brand Assets / Content / References / Constraints / Open Questions / **File Paths**（`files/<itemId>/<id>_<name>`）/ **Acceptance Criteria（候補）**（必要項目から機械的に作成）。
「クライアント回答から導いた候補です。技術仕様は確定していません」を明記。

## Claude Code への渡し方
1. 案件詳細 → 案件開始パック → プロファイル Web Development → 生成 → コピー（またはMarkdownダウンロード）。
2. MCP：`prepare_handoff`（保存せずプレビュー）、`generate_intake_package`（confirm:true で保存）。
