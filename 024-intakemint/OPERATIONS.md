# OPERATIONS

## 構成
単一の Node.js プロセス（API＋PWA静的配信＋ジョブワーカー）。本番は PostgreSQL 16 + S3互換ストレージ推奨。`Dockerfile` / `docker-compose.yml` 同梱（**本番デプロイは未実施・人間承認が必要**）。

## 起動
```
npm ci && npm run build
cp .env.example .env   # 値を設定
npm start               # = NODE_ENV=production tsx src/server/index.ts
```
- ワーカーを別プロセスにする場合：Webは `DISABLE_WORKER=true`、別プロセスで同じコードを起動（ジョブは `SKIP LOCKED` で重複実行されない）。
- ヘルスチェック：`GET /api/health`。

## サンプル環境の分離
`SEED_SAMPLE=true` または `npm run seed` で架空の「Sample Creative Studio」（`is_sample=true`）を作成。**本番テナントでは実行しない**。デモ用パスワードは `SEED_PASSWORD` で変更。

## ジョブ
| job | 周期 | 内容 |
|---|---|---|
| reminder_scan | 15分ごと（時単位dedupe） | 期限前/当日/超過のリマインド下書き（auto設定なら送信キュー） |
| send_reminder | 承認時/予定時刻 | 深夜帯は次の許可時刻へ延期、案件がReady等ならskip |
| send_email | キュー | 失敗時指数バックオフ、4回失敗で failed＋通知 |
| ai_case_analysis | 回答/提出の2秒後（案件ごとdedupe） | AIゲートウェイ経由 |
| retention_purge | 日次 | 保存期間超過のアーカイブ案件削除 |

## バックアップ / リストア
- アプリ：設定 → バックアップ・エクスポート（ZIP：manifest[schemaVersion, appVersion, checksums, relation fingerprint] + data/*.json + objects/*）。
- 空環境へ：`npm run restore -- backup.zip`（関係フィンガープリント一致を検証・不一致なら終了コード2）。
- DB：PostgreSQL の PITR（マネージドDBのバックアップ）を併用。オブジェクトはバケットのバージョニング/レプリケーション。
- 定期的に **空環境リストア試験** を行う（テスト #27 / E2E-8 と同手順）。

## 監視
- `/api/health`、`email_outbox` の failed、`jobs` の failed、通知 `reminder_failure`。
- AI利用量：設定 → AIとプライバシー（`ai_calls` 集計）。

## インシデント
- リンク漏えい：案件 → 共有リンク → 無効化／再発行。
- APIトークン漏えい：設定 → MCP/API → 失効。
- 署名鍵漏えい：`SIGNING_SECRET` をローテーション（既存Signed URLは即無効）。
- 案件データ削除依頼：案件 → 設定 → 完全削除（監査に記録）。
