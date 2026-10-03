# DECISIONS

| # | 決定 | 理由 / 代替案 |
|---|---|---|
| D1 | React + TypeScript（Vite）PWA、Node.js + Fastify API、単一リポジトリ | 1人で保守しやすい。Next.js は SSR 不要のため見送り |
| D2 | DB は PostgreSQL 方言に統一。開発/テスト/デモは PGlite（WASM Postgres）、本番は node-postgres | 同一SQLで両対応、DBサーバーなしで購入者がすぐ試せる。実PG16でも検証 |
| D3 | 検索は pg_trgm（GIN）| 日本語の形態素解析なしで部分一致可能。大規模時は専用検索へ |
| D4 | 認証は自前（scrypt＋セッションCookie＋CSRFトークン）、クライアントはアカウント不要の署名トークン | 外部Auth SaaSの費用・依存を回避（Clerk/Auth0 は SOURCE_NOTES に比較）。SSO/SCIMはPro |
| D5 | ジョブはDBキュー（SKIP LOCKED） | Redis不要。pg-boss/BullMQ は将来候補 |
| D6 | AIはゲートウェイ経由の候補方式。既定プロバイダはローカル決定的判定 | 外部送信ゼロで出荷でき、テスト可能。外部AIは3条件オプトイン |
| D7 | 充足判定・Ready・パック生成はすべて決定的 | 「AIだけでReady禁止」「架空Requirement禁止」を構造的に保証 |
| D8 | 非表示回答は保持・除外（retain_excluded） | 条件を戻したときの再入力を避けつつ、進捗/Ready/パックの正しさを守る |
| D9 | 必須質問で項目外のもの・ルールで必須化され得る質問は暗黙項目 `q:<id>` | 分母の取りこぼし防止（EC選択で7→9件） |
| D10 | リマインド既定は「下書き→人間承認」、メール既定は outbox（実送信なし） | 実Client送信は人間承認が必要という制約に合わせる |
| D11 | ファイル原本は1回書込み（上書き不可）、Signed URLは sandbox CSP | 原本を source of truth に、SVG等のXSSを防止 |
| D12 | MCP の書込みツールは confirm:true 必須・メール送信不可 | 外部送信/Reminderは明示確認の要件 |
| D13 | フォントファイルを同梱しない（システムフォントスタック） | 無断同梱禁止。ワードマークのアウトライン化は release 前に |
| D14 | ロゴは葉2枚が集まる抽象形（brand_board 準拠のオリジナルSVG） | 書類＋チェックの直球表現を回避 |
| D15 | Server-side が常に正。ポータルの条件分岐はクライアントでも同一コードで即時評価 | UX と安全性の両立 |
