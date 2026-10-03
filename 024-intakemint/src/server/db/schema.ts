// PostgreSQL schema (also runs on PGlite for dev/test). See DATA_MODEL.md.
// Every tenant-owned table carries org_id; every query from the service layer filters by org_id.
export const SCHEMA_VERSION = 1

export const MIGRATIONS: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: /* sql */ `
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_sample boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  name text NOT NULL,
  password_hash text,
  disabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_uq ON users (lower(email));

CREATE TABLE memberships (
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner','admin','manager','editor','viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);
CREATE INDEX memberships_user_idx ON memberships (user_id);

CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  csrf_token text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE api_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  last_used_at timestamptz
);

CREATE TABLE workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX workspaces_org_idx ON workspaces (org_id);

CREATE TABLE templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  industry text NOT NULL DEFAULT 'generic',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  draft jsonb NOT NULL,
  current_version_id uuid,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX templates_org_ws_idx ON templates (org_id, workspace_id);

-- Immutable published versions. Cases pin a version; publishing creates a new row.
CREATE TABLE template_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  version integer NOT NULL,
  name text NOT NULL,
  definition jsonb NOT NULL,
  published_by uuid REFERENCES users(id) ON DELETE SET NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_id, version)
);
CREATE INDEX template_versions_org_idx ON template_versions (org_id);

CREATE TABLE cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  template_version_id uuid NOT NULL REFERENCES template_versions(id),
  client_name text NOT NULL,
  client_email text,
  project_name text NOT NULL,
  owner_id uuid REFERENCES users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','in_progress','needs_client','needs_internal_review','ready','started','archived','cancelled')),
  started_at timestamptz,
  target_ready_date date,
  timezone text NOT NULL DEFAULT 'Asia/Tokyo',
  progress jsonb NOT NULL DEFAULT '{}'::jsonb,
  missing_summary text NOT NULL DEFAULT '',
  ai_enabled boolean NOT NULL DEFAULT true,
  internal_signoff_at timestamptz,
  internal_signoff_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ready_at timestamptz,
  ready_override jsonb,
  client_submitted_at timestamptz,
  tags text[] NOT NULL DEFAULT '{}',
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
CREATE INDEX cases_org_status_activity_idx ON cases (org_id, status, last_activity_at DESC);
CREATE INDEX cases_org_ws_idx ON cases (org_id, workspace_id, last_activity_at DESC);
CREATE INDEX cases_org_target_idx ON cases (org_id, target_ready_date) WHERE status NOT IN ('ready','started','archived','cancelled');

-- Client access: only sha256(token) stored. Expiring + revocable. No permanent public URL.
CREATE TABLE case_access_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  require_email_verification boolean NOT NULL DEFAULT false,
  email_verified_at timestamptz,
  verification_code_hash text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
CREATE INDEX case_access_tokens_case_idx ON case_access_tokens (case_id);

CREATE TABLE responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  question_id text NOT NULL,
  value jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1,
  updated_by_kind text NOT NULL CHECK (updated_by_kind IN ('client','internal','system')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, question_id)
);
CREATE INDEX responses_org_idx ON responses (org_id);

CREATE TABLE item_states (
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  item_id text NOT NULL,
  review_status text NOT NULL DEFAULT 'none' CHECK (review_status IN ('none','accepted','rejected','needs_review','not_applicable')),
  note text,
  due_date date,
  reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  PRIMARY KEY (case_id, item_id)
);

CREATE TABLE files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  item_id text,
  original_name text NOT NULL,
  storage_key text NOT NULL,
  mime text NOT NULL,
  ext text NOT NULL,
  size bigint NOT NULL,
  sha256 text NOT NULL,
  status text NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review','accepted','rejected')),
  scan_status text NOT NULL DEFAULT 'not_scanned' CHECK (scan_status IN ('not_scanned','clean','infected','error')),
  ai_excluded boolean NOT NULL DEFAULT false,
  classification jsonb,
  extraction jsonb,
  review_note text,
  uploaded_by_kind text NOT NULL CHECK (uploaded_by_kind IN ('client','internal')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX files_case_idx ON files (case_id, item_id);
CREATE INDEX files_org_idx ON files (org_id, created_at DESC);

CREATE TABLE reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  target_type text NOT NULL CHECK (target_type IN ('item','file','response','ai_candidate','case')),
  target_id text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('accept','reject','needs_client','needs_review','dismiss','not_applicable','signoff','reopen')),
  note text,
  actor_type text NOT NULL DEFAULT 'user',
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reviews_case_idx ON reviews (case_id, created_at DESC);

CREATE TABLE ai_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('follow_up','ambiguous','missing','contradiction','classification','extraction')),
  question_id text,
  item_id text,
  file_id uuid REFERENCES files(id) ON DELETE CASCADE,
  fingerprint text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','accepted','dismissed','sent_to_client','resolved')),
  provider text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_by uuid,
  resolved_at timestamptz,
  UNIQUE (case_id, fingerprint)
);
CREATE INDEX ai_candidates_case_idx ON ai_candidates (case_id, status);

-- Follow-up questions approved by a human and shown to the client (not part of the template).
CREATE TABLE followups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  candidate_id uuid REFERENCES ai_candidates(id) ON DELETE SET NULL,
  question_id text,
  text text NOT NULL,
  options jsonb,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','answered','resolved','cancelled')),
  answer jsonb,
  answered_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX followups_case_idx ON followups (case_id, status);

CREATE TABLE reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  stage text NOT NULL,
  dedupe_key text NOT NULL UNIQUE,
  scheduled_for timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','sent','failed','skipped','cancelled')),
  items jsonb NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  email_id uuid,
  approved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX reminders_case_idx ON reminders (case_id, created_at DESC);
CREATE INDEX reminders_due_idx ON reminders (status, scheduled_for);

CREATE TABLE email_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_id uuid REFERENCES cases(id) ON DELETE SET NULL,
  to_address text NOT NULL,
  from_name text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed')),
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  provider text,
  provider_message_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX email_outbox_org_idx ON email_outbox (org_id, created_at DESC);

CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_id uuid REFERENCES cases(id) ON DELETE CASCADE,
  type text NOT NULL,
  title text NOT NULL,
  count integer NOT NULL DEFAULT 1,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_org_idx ON notifications (org_id, updated_at DESC);

CREATE TABLE packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  version integer NOT NULL,
  profile text NOT NULL,
  content jsonb NOT NULL,
  markdown text NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, version)
);

CREATE TABLE audit_logs (
  id bigserial PRIMARY KEY,
  org_id uuid NOT NULL,
  actor_type text NOT NULL,
  actor_id text,
  action text NOT NULL,
  target_type text,
  target_id text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_org_idx ON audit_logs (org_id, created_at DESC);
CREATE INDEX audit_logs_target_idx ON audit_logs (org_id, target_type, target_id);

CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  run_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','failed')),
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  last_error text,
  dedupe_key text UNIQUE,
  locked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_queue_idx ON jobs (status, run_at);

-- Permission-filtered full-text search (pg_trgm works for Japanese without a tokenizer).
CREATE TABLE search_index (
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id uuid,
  case_id uuid REFERENCES cases(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  tags text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_type, entity_id)
);
CREATE INDEX search_index_org_idx ON search_index (org_id);
CREATE INDEX search_index_trgm_idx ON search_index USING gin ((title || ' ' || body) gin_trgm_ops);

-- Text prepared for / derived from AI processing. Deleted together with the case (and when AI is turned off for a file).
CREATE TABLE ai_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  source_type text NOT NULL,
  source_id text NOT NULL,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, source_type, source_id)
);

CREATE TABLE ai_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_id uuid,
  provider text NOT NULL,
  purpose text NOT NULL,
  input_chars integer NOT NULL DEFAULT 0,
  external boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_calls_org_idx ON ai_calls (org_id, created_at DESC);

`,
  },
]
