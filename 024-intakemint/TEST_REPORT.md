# TEST_REPORT

実行日：2026-10-03 / Node v22.22.0 / Linux（クラウドコンテナ、4 vCPU）/ Chromium（Playwright 1.63, `/opt/pw-browsers/chromium`）

## 結果サマリ
| スイート | コマンド | 結果 |
|---|---|---|
| エンジン・セキュリティユーティリティ | `npx vitest run tests/engine.test.ts` | 18 / 18 pass |
| HTTP API（テナント分離・トークン・CSRF・RBAC・SSRF等） | `npx vitest run tests/api.test.ts` | 15 / 15 pass |
| サービスフロー（E2E相当・MCP・Backup） | `npx vitest run tests/flows.test.ts` | 24 / 24 pass |
| 実PostgreSQL 16 フロー＋検索＋Backup/Restore | `TEST_DATABASE_URL=… TEST_DATABASE_URL2=… npx vitest run tests/postgres.test.ts` | 1 / 1 pass（URL未設定時はskip） |
| ブラウザE2E（desktop / iPhone 13 / Pixel 7 / iPad gen7 プロファイル） | `npm run test:e2e` | 24 / 24 pass（6シナリオ×4端末） |
| MCP stdio スモーク（公式SDKクライアント↔サーバープロセス、PostgreSQL） | `DATABASE_URL=… npx tsx scripts/mcp-smoke.ts` | OK（10ツール列挙・事実回答・confirmなし書込はプレビュー） |
| 型チェック | `npm run typecheck` | エラー0 |
| 依存脆弱性 | `npm audit` | 0件 |

## 必須テスト対応表（プロンプト §27）
| # | 内容 | テスト |
|---|---|---|
| 1 | tenant A→B 拒否 | api: `#1 tenant A cannot access tenant B`（案件/回答/リンク/パック/ファイルURL/レビュー/一覧） |
| 2 | expired/revoked token 拒否 | api: `#2 expired / revoked client token`, `reissue revokes previous links` |
| 3 | account不要 Client flow | api: `#3 account-less client flow`（回答・保存・再開・アップロード・送信） |
| 4 | required progress | engine: `#4`（7件中5件=71%） |
| 5 | hidden question progress | engine: `#5`（分母除外・回答保持） |
| 6 | conditional logic | engine: `#6`（EC/採用・カスケード・draftルール無効）、e2e: E2E-3 UI |
| 7 | circular rule 検知 | engine: `#7`、flows: 循環テンプレートの公開拒否 |
| 8 | AI不足候補を自動確定しない | flows: `#8 / E2E-2` |
| 9 | Required File 3/5 → Partial | engine: `#9`、flows: E2E-1 |
| 10 | invalid MIME/size 拒否 | engine: `#10`、api: `#10 (HTTP)`（偽装PNG・EICAR） |
| 11 | signed URL 期限 | engine: `#11`、api: `signed URL route` |
| 12 | File AI除外 | flows: `#12 / #23 / E2E-5` |
| 13 | contradiction candidate | engine: `#13`（10 vs 全25商品・自動修正なし） |
| 14 | Reminder 重複なし | flows: `#14`（dedupe・深夜帯延期・失敗→通知）＋通知ストーム防止 |
| 15 | Ready条件未達で Ready 不可 | flows: `#15 / #16`、`uploads alone never make a case Ready` |
| 16 | override 理由必須 | flows: `#15 / #16`（空/短い理由拒否、actor/time記録、監査） |
| 17 | Ready後必須変更で再評価 | flows: `#17 / E2E-6`（ファイル差戻・必須回答変更、任意項目は維持） |
| 18 | Intake Package source reference | flows: `#18 / #19` |
| 19 | AIが架空Requirementを作らない | flows: `#18 / #19`（全エントリが既存の質問/ファイル/項目を参照、Unknown表示）＋AnthropicProviderは未知IDの候補を破棄 |
| 20 | Published Template 変更で既存Case不変 | flows: `#20` |
| 21 | Client token から他Case拒否 | api: `#21` |
| 22 | Search tenant filter | api: `#22`（LIKEワイルドカードのエスケープも） |
| 23 | AI OFF で provider call 0 | flows: 組織OFF・案件OFF（スパイ外部プロバイダ呼び出し0、`ai_calls` 0件） |
| 24 | deleted Case を AI index から削除 | flows: `#24`（ai_documents・search_index・オブジェクト・回答削除、監査tombstone） |
| 25 | ZIP path traversal | engine: `#25`、flows: 復元時のzip-slip拒否・改ざんチェックサム拒否 |
| 26 | CSV formula injection | engine: `#26` |
| 27 | Backup/Restore relation 一致 | flows: `#27 / E2E-8`、postgres.test（2つの実DB間） |
| 28 | iPhone PWA upload flow | e2e: `#28 / E2E-4`（iPhone 13 プロファイル：写真3枚+PDF、偽装ファイル拒否、保存して終了、再開） |
| 29 | MCP write 前確認 | flows: `#29 / E2E-7`、mcp-smoke |
| 30 | audit log | api: `#30`（主要アクション・actor種別・本文非記録） |

## E2E（§28）
| E2E | 内容 | テスト |
|---|---|---|
| 1 | Web制作Template→共有→回答→条件分岐→Logo未提出/Images 3/5→Reminder→追加提出→Review→Ready→Developer Handoff | flows: `E2E-1`（サービス層）、e2e: Ready→Handoff UI |
| 2 | 曖昧回答→AI追加質問Candidate→人間確認→Client回答→Completeness更新 | flows: `#8 / E2E-2` |
| 3 | EC回答→EC専用質問表示・採用非表示 | flows: `E2E-3`、e2e: `E2E-3 / #6 UI`（4端末） |
| 4 | iPhone PWAで写真/PDF Upload→PC担当者Review | e2e: `#28 / E2E-4`（スマホ→PCで承認/差戻→クライアントに理由表示） |
| 5 | AI対象外機密File→外部AI callなし | flows: confidential file excluded |
| 6 | Ready後 Accepted File Reject→Ready解除/再Review | flows: `#17 / E2E-6` |
| 7 | MCP「この案件開始できる？」→不足項目を事実で回答→揃った後Package生成 | flows: `#29 / E2E-7`、mcp-smoke |
| 8 | 全data export→空環境restore→Case/Responses/Files metadata/Package一致 | flows: `#27 / E2E-8`、postgres.test |

追加：PWA manifest/アイコン/Service Worker登録、オフライン下書き（アップロード・送信の無効化→復帰後同期）、モバイルの横スクロールなし。

## 性能（§29）— 参考値（販売保証値ではない）
PostgreSQL 16（ローカル）、`docs/perf-results-postgres.json`：

| 案件/組織 | 案件作成+回答 / 件 | Dashboard p50 | Search p50 | Package p50 | Recompute p50 | Upload p50 | Reminder scan（全件） |
|---|---|---|---|---|---|---|---|
| 10 | 27.6ms | 1.7ms | 1.0ms | 13.6ms | 7.0ms | 26.6ms | 47ms |
| 100 | 19.9ms | 2.1ms | 1.6ms | 11.2ms | 5.6ms | 18.6ms | 185ms |
| 1,000 | 17.5ms | 2.2ms | 12.2ms | 10.3ms | 5.5ms | 19.6ms | 1.7s |
| 50,000（合成：回答60万・ファイル50万行） | — | 45.5ms | 50ms | — | — | — | — |
ダッシュボードのクエリは `cases_org_status_activity_idx` の Index Scan を確認。リマインドスキャンは案件数に線形（1.7ms/件）→ 10万件規模では対象を期限±N日の案件に限定するクエリ最適化が必要（NEXT_STEPS）。

## 実機確認
- **実機（物理iPhone/Android/iPad）での確認は未実施**。Playwright の端末プロファイル（iPhone 13・Pixel 7・iPad gen7のビューポート/UA/タッチ、Chromiumエンジン）での検証のみ。iOS Safari（WebKit）固有の挙動（ホーム画面追加、カメラ起動、ストレージ退避）は販売前に実機で確認が必要（RELEASE_CHECKLIST）。
- スクリーンショット：`docs/screenshots/`。

## 未検証
- S3/R2 アダプタ（実バケット未接続）、Resend 実送信、Anthropic 実API呼び出し（キー未使用・ポリシー上未実施）、ClamAV 接続、Docker イメージのビルド（デーモン未起動）、本番デプロイ。

## ドキュメントレビューで見つかった不具合の修正（回帰テスト追加）
AIチェック後のステータス再計算（Readyのまま残る問題）／スキャン失敗時の受付拒否／確認コード10分失効／複数選択の「＝」「のいずれか」／外部AI通信エラー時のローカル判定フォールバック／ポータル用PWAマニフェスト（ホーム画面から自分の提出ページを開く）／本番で新規登録リンク非表示／`.env` 読込／tsx を dependencies へ／MCP起動は `npm --silent`（stdout汚染防止）／ビルダーの上限数・要レビュー既定表示／リンク有効日数の選択UI。
