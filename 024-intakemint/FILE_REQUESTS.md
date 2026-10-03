# FILE_REQUESTS

## 受付フロー（`intake.uploadFile`）
1. 項目が file 型・表示中（対象外ならエラー）・`maxCount` 未満であること。
2. ファイル名サニタイズ（パス成分・制御文字除去、日本語名は保持）。
3. `checkUpload`：**拡張子の許可リスト × マジックバイト判定 × サイズ上限**（項目の maxSizeMB と MAX_UPLOAD_MB の小さい方）。PNG/JPEG/GIF/WebP/HEIC/MP4/PDF/AI/EPS/ZIP/DOCX/XLSX/PPTX/SVG/TXT/CSV。中身と拡張子が一致しないものは拒否。
4. マルウェアスキャン（`Scanner`）：既定は EICAR テストシグネチャ検出のみ（**本物のウイルス対策ではない**）。本番候補は ClamAV（clamd INSTREAM、別プロセス/GPL）または S3 の GuardDuty Malware Protection。検出時は保存せず拒否＋監査。
5. 原本を `org/case/fileId.ext` に **1回だけ書込み**（`flag: 'wx'` で上書き不可）。原本が source of truth。抽出・分類はDB側に別保存。
6. `files` 行（sha256、scan_status、ai_excluded）。差し戻し済み項目は再提出で `none` に戻る。
7. 分類・抽出（AIゲートウェイ経由、AI OFF・ファイル除外時はスキップ）。

## 提出数（Partial count）
`minCount` に対して非差戻ファイル数を数える（例：商品画像5枚必要・3枚提出 → partial 3/5）。承認は「承認件数 ≥ min」。

## ダウンロード（Signed URL）
`/api/files/:id/url` が HMAC 署名付きURL（既定 300 秒）を発行。`/api/files/signed` は署名・期限・disposition を検証し、`Content-Security-Policy: default-src 'none'; sandbox`、`X-Content-Type-Options: nosniff`、`Cache-Control: private, no-store` で返す。SVG は `application/octet-stream` で配信しスクリプトを実行させない。期限切れ/改ざん → 403（テスト #11）。

## 分類・抽出（AI Understanding）
- カテゴリ：brand / company / product / reference / legal / finance / other（項目カテゴリ＞本文＞ファイル名）。**ファイル名だけでは confidence=low**。「分類は候補です。原本を確認してください」を明示。
- 抽出：text/csv は本文プレビュー（候補）。PDF/画像は OCR/Vision プロバイダ未接続のため未実施と表示。精度は保証しない。
- ファイル単位の AI 除外：クライアントのアップロード時チェック or 内部から切替。除外すると `ai_documents` と抽出結果を削除し、以後の AI 呼び出しに含めない（テスト #12 / E2E-5）。

## クライアント側
- iPhone/Android では `accept` に `image/*` を含め、写真ライブラリ/カメラから選択可能。複数選択可。
- オフライン時はアップロード不可（キューしない）。
- 確認前の自分のアップロードのみ削除可能。差し戻し理由を表示。
