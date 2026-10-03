# IntakeMint — AIヒアリング・情報回収・提出物整理ツール（商品 #024）

**必要な情報が、1回でちゃんと揃う。**
仕事を始めるために必要な情報・ファイルを、AIが質問・不足確認・整理して、全部揃うまで管理し、案件開始パック（Claude Code・制作担当向けHandoff）にまとめます。

<p><img src="src/web/public/icon.svg" width="72" alt="IntakeMint icon"></p>

## クイックスタート（デモ）
```bash
cd 024-intakemint
npm install
npm run build
SEED_SAMPLE=true PGLITE_DIR=./data/pg npm run dev:server   # http://localhost:8787
# ログイン: owner@sample-creative.example / sample-demo-password（架空サンプル。本番では使用しない）
```
本番は PostgreSQL（`DATABASE_URL`）＋ `npm start`。設定は `.env.example`。

## 主な機能
AIヒアリング（追加質問候補）／回答不足・矛盾チェック（候補）／ファイル回収（必要数・3/5表示・検証・原本保持）／条件分岐／リマインド（未提出のみ・重複なし・深夜帯回避・承認制）／Ready判定（決定的＋サインオフ＋理由付きoverride）／案件開始パック（出典付き・Handoff 8プロファイル）／アカウント不要のClient Portal（PWA・オフライン下書き）／検索／監査／Backup・Restore／MCP（10ツール、書込みは確認必須）。

## ドキュメント
| 開発 | |
|---|---|
| [PLAN](PLAN.md) / [PROGRESS](PROGRESS.md) / [DECISIONS](DECISIONS.md) / [NEXT_STEPS](NEXT_STEPS.txt) | 計画・進捗・判断・次の作業 |
| [DEVELOPMENT](DEVELOPMENT.md) / [DATA_MODEL](DATA_MODEL.md) / [INTAKE_ENGINE](INTAKE_ENGINE.md) | 開発・データモデル・全体フロー |
| [CONDITIONAL_LOGIC](CONDITIONAL_LOGIC.md) / [COMPLETENESS_ENGINE](COMPLETENESS_ENGINE.md) / [FILE_REQUESTS](FILE_REQUESTS.md) | 条件分岐・充足判定・ファイル |
| [AI_REVIEW](AI_REVIEW.md) / [PACKAGE_HANDOFF](PACKAGE_HANDOFF.md) / [MCP_PLUGIN](MCP_PLUGIN.md) | AI・パック・MCP |
| [PRIVACY](PRIVACY.md) / [SECURITY](SECURITY.md) / [OPERATIONS](OPERATIONS.md) / [OPERATING_COSTS](OPERATING_COSTS.md) | プライバシー・セキュリティ・運用・コスト |
| [TEST_REPORT](TEST_REPORT.md) / [RELEASE_CHECKLIST](RELEASE_CHECKLIST.md) / [SOURCE_NOTES](SOURCE_NOTES.md) / [BRANDING](docs/BRANDING.md) | テスト・販売前チェック・調査・ブランド |
| 購入者向け | [buyer_docs/](buyer_docs/) |

## 重要な制約
有料契約・本番公開・実Clientへの送信・実Email/Connector接続・実個人/機密データの外部AI送信は、人間の承認なしに行いません（既定：AIはローカル判定、メールはローカル記録のみ）。
