# RELEASE_CHECKLIST — 販売前チェック

凡例：☑ = 本リポジトリで確認済み ／ ☐ = 人間の確認・承認が必要

## 品質
- ☑ `npm run typecheck` エラー0
- ☑ `npm test` 53件 pass（PGlite）
- ☑ 実PostgreSQL 16 での主要フロー＋Backup/Restore pass
- ☑ `npm run test:e2e` 24件 pass（desktop / iPhone 13 / Pixel 7 / iPad プロファイル）
- ☑ MCP stdio スモーク
- ☑ `npm audit` 0件
- ☐ **物理実機**：iPhone Safari（回答・写真/カメラ・PDF・保存して終了・再開・ホーム画面追加・standalone表示・セーフエリア）、Android Chrome（インストール）、iPad、PC（Chrome/Edge/Safari/Firefox）
- ☐ スクリーンリーダー（VoiceOver/TalkBack）での主要操作確認

## セキュリティ / プライバシー
- ☑ テナント分離・RBAC・CSRF・Signed URL・Upload検証・SSRF・ZIP・CSV・監査のテスト
- ☐ 本番 `SIGNING_SECRET`（32文字以上・乱数）、`ALLOW_SIGNUP` 方針、`TRUST_PROXY`
- ☐ HTTPS 終端・HSTS 確認
- ☐ マルウェアスキャン方針（ClamAV/GuardDuty を接続するか、販売資料でEICARのみと明示）
- ☐ 外部AI送信の可否と顧客合意（既定はOFF）
- ☐ 利用規約・プライバシーポリシー

## 運用
- ☐ 本番DB・ストレージ・ホスティング契約（有料）／デプロイ（人間承認）
- ☐ メール送信プロバイダ契約・ドメイン認証（実Client送信は承認後）
- ☐ バックアップ：空環境リストア試験を本番構成で実施
- ☐ 監視（/api/health、failed jobs/emails）
- ☑ サンプル環境は `is_sample` で分離、`SEED_SAMPLE` は本番で無効

## 販売資料
- ☑ buyer_docs/（はじめに〜THIRD_PARTY_NOTICES）
- ☑ OPERATING_COSTS.md（☐ 単価の公式再確認）
- ☐ 名称・商標・ドメイン確認（IntakeMint）
- ☐ 「医療診断・法的判断・本人確認/KYCを自動保証しない」「サンプルは法的必要書類を保証しない」「OCR/AI精度を保証しない」を販売ページに明記
