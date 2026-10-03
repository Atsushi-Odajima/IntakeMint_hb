# DATA_MODEL

PostgreSQL スキーマ（`src/server/db/schema.ts`、PGlite でも同一SQLで動作）。`SCHEMA_VERSION = 1`。

## 階層とテナント分離
`Organization → Workspace → Template(+TemplateVersion) → Case`。テナント所有の全テーブルが `org_id` を持ち、サービス層の全クエリが `WHERE org_id = $n` で絞り込む（`search_index` も同様。アプリ側での後フィルタはしない）。Client/Respondent は `users` に存在せず、`case_access_tokens` で1案件だけにアクセスする。

| テーブル | 主な列 | 備考 |
|---|---|---|
| organizations | id, name, slug, settings(jsonb), is_sample | settings: aiEnabled, timezone, retentionDays, branding, allowUrlTitleFetch |
| users / memberships | email(lower unique), password_hash(scrypt) / role ∈ owner,admin,manager,editor,viewer | 内部ユーザーのみ |
| sessions / api_tokens | token_hash(sha256), csrf_token, expires_at / token_hash, revoked_at | 生トークンは保存しない |
| workspaces | org_id, name | |
| templates | status ∈ draft,published,archived, draft(jsonb), current_version_id | 下書きは編集可 |
| template_versions | template_id, version, definition(jsonb) UNIQUE(template_id,version) | **不変**。公開=新しい行 |
| cases | template_version_id, client_name/email, project_name, owner_id, status, target_ready_date, timezone, progress(jsonb), missing_summary, ai_enabled, internal_signoff_at/by, ready_at, ready_override(jsonb), client_submitted_at, tags, last_activity_at | status ∈ draft,sent,in_progress,needs_client,needs_internal_review,ready,started,archived,cancelled |
| case_access_tokens | token_hash UNIQUE, expires_at, revoked_at, require_email_verification, email_verified_at, verification_code_hash | 永続公開URLなし |
| responses | case_id, question_id UNIQUE(case_id,question_id), value(jsonb), version, updated_by_kind | 非表示質問の回答も保持 |
| item_states | (case_id,item_id) PK, review_status ∈ none,accepted,rejected,needs_review,not_applicable, note, due_date | 項目単位レビュー |
| files | item_id, original_name, storage_key, mime, ext, size, sha256, status ∈ pending_review,accepted,rejected, scan_status, ai_excluded, classification, extraction | 原本は storage_key に1回だけ書込み |
| reviews | target_type, target_id, decision, note, actor | レビュー履歴（追記のみ） |
| ai_candidates | kind, question_id/file_id, fingerprint UNIQUE(case_id,fingerprint), payload, status ∈ open,accepted,dismissed,sent_to_client,resolved, provider | AI出力は必ずここ（候補） |
| followups | candidate_id, question_id, text, options, status ∈ open,answered,resolved,cancelled, answer | 人間が承認した追加質問 |
| reminders | stage, dedupe_key UNIQUE, scheduled_for, status ∈ draft,approved,sent,failed,skipped,cancelled, items(jsonb), subject, body | 二重送信防止 |
| email_outbox | to_address, subject, body, status, attempts, last_error, provider | 送信履歴・リトライ |
| notifications | type, title, count | 10分以内の同種通知を集約 |
| packages | version UNIQUE(case_id,version), profile, content(jsonb), markdown | 案件開始パック |
| audit_logs | bigserial, actor_type, actor_id, action, target, meta, ip | 追記のみ。回答本文は入れない |
| jobs | type, payload, run_at, status, attempts, dedupe_key UNIQUE | DBキュー（FOR UPDATE SKIP LOCKED） |
| search_index | (entity_type,entity_id) PK, org_id, case_id, title, body, tags | pg_trgm GIN（日本語対応） |
| ai_documents | case_id, source_type, source_id, content | AI用インデックス。案件削除・AI OFF・ファイル除外で削除 |
| ai_calls | provider, purpose, input_chars, external | プロバイダ呼び出しログ（AI OFF=0件の証跡） |

## 主要インデックス（大規模想定）
- `cases (org_id, status, last_activity_at DESC)` … ダッシュボード各バケット（50,000案件で Index Scan を確認）
- `cases (org_id, target_ready_date) WHERE status NOT IN (...)` … 期限超過/リマインド
- `responses UNIQUE(case_id, question_id)` … 案件単位の読み出し（60万行で 0.5ms）
- `files (case_id, item_id)`, `files (org_id, created_at DESC)`
- `audit_logs (org_id, created_at DESC)`, `(org_id, target_type, target_id)`
- `search_index USING gin ((title||' '||body) gin_trgm_ops)`

想定規模（Organizations 1,000 / Cases 1,000,000 / Responses 50,000,000 / File metadata 20,000,000）に向けた追加策（未実施・販売保証値ではない）：`responses`・`files`・`audit_logs` の `org_id` ハッシュパーティショニング、`search_index` の別DB/専用検索エンジン化、監査ログのアーカイブ。

## Template definition（jsonb）
`sections[] / questions[] / rules[] / requiredItems[] / completionRules / reminderPolicy / packageTemplate / hiddenAnswerPolicy / intro / completionMessage`。型は `src/shared/types.ts`、検証は `definitionSchema`（zod）＋ `lintDefinition`（ID重複・参照切れ・循環）。
