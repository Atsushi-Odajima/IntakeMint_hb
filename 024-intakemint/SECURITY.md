# SECURITY

| 対策 | 実装 | テスト |
|---|---|---|
| テナント分離 | 全サービスクエリに `org_id` 条件。検索もSQL内で `org_id` フィルタ | #1, #22, MCP他テナント拒否 |
| RBAC（server-side） | `services/rbac.ts` の権限マトリクスを各サービス関数の先頭で `requirePerm` | viewer/editor 拒否テスト |
| 認証 | scryptパスワード、httpOnly/SameSite=Lax/Secure(本番) セッションCookie、sha256保存、期限付き | ログイン失敗401 |
| CSRF | 状態変更リクエストは `x-csrf-token` ヘッダ必須（セッション固有）。Bearer APIトークンは対象外 | CSRFなし→403 |
| Client token | 256bit乱数、sha256保存、期限・失効・再発行、案件1件に束縛、メール確認（任意） | #2, #21 |
| Signed URL | HMAC-SHA256・期限・disposition署名。sandbox CSP・nosniff・no-store | #11 |
| Upload validation | 拡張子許可リスト×マジックバイト×サイズ、ファイル名サニタイズ、原本上書き不可、EICAR検出、スキャン失敗時は受付拒否 | #10 |
| Rate limit | 全体 600/分/IP、ログイン 10/分、ポータル 120/分、確認コード 5〜10/10分 | — |
| Schema validation | zod（全APIボディ・クエリ・テンプレート定義） | lint/検証テスト |
| SQL injection | すべて `$n` パラメータ。LIKE はワイルドカードをエスケープ | `%` 検索テスト |
| XSS | React の自動エスケープ、`dangerouslySetInnerHTML` 不使用、CSP `script-src 'self'`、SVGは attachment+octet-stream | ヘッダテスト |
| CSP 等 | helmet：default-src 'self'、frame-ancestors 'none'、object-src 'none'、HSTS(本番)、Referrer-Policy no-referrer | ヘッダテスト |
| SSRF | URL取得は既定OFF。http/https・標準ポートのみ、DNS解決後のプライベート/メタデータIP拒否、リダイレクト毎に再検証、5秒・512KB上限 | SSRFテスト |
| ZIP path traversal | 復元時に `..`・絶対パス・ドライブレター・想定外プレフィックスを拒否、展開サイズ/件数上限（zip bomb）、チェックサム検証 | #25 |
| CSV formula injection | `= + - @ TAB CR` 先頭をアポストロフィで無効化 | #26 |
| Secrets | すべて環境変数（`.env.example`）。本番で `SIGNING_SECRET` 32文字未満なら起動しない | — |
| Token rotation | APIトークン失効、共有リンク再発行（既存無効化）、`SIGNING_SECRET` ローテーションで既存Signed URL無効化 | 再発行テスト |
| Audit | テンプレート変更・案件・リンク発行/失効・回答・アップロード/レビュー・リマインド・override・パック・エクスポート・ロール変更・MCP書込 | #30 |
| ログ | リクエストログはトークン・署名をマスク（`LOG_REQUESTS=true` 時のみ出力） | — |

## 既知の制限（未対応・要判断）
- マルウェアスキャンは EICAR のみ（ClamAV/GuardDuty の接続は運用で）。
- 2FA/SSO/SCIM 未実装（Pro候補）。パスワードリセットは管理者による再設定のみ。
- PGlite は単一プロセス向け。本番は PostgreSQL（`FOR UPDATE SKIP LOCKED` で複数ワーカー可）。
- レート制限はプロセス内メモリ（複数台構成では共有ストア化が必要）。
- 依存パッケージの脆弱性：`npm audit` 0件（2026-10-03時点）。
