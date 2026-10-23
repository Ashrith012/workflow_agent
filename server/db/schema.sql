-- Idempotent schema; applied on every server start (server/db/index.ts).

-- Roles: admin = tenant admin (governs), fde = forward deployed engineer (builds), user = end user.
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin', 'fde', 'user')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Databases created before the fde role existed carry the two-role check; swap it in place.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'fde', 'user'));

-- One live version per event key; publishing the same key again replaces it and bumps the version.
CREATE TABLE IF NOT EXISTS published_workflows (
  event_key     TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  workflow      JSONB NOT NULL,
  trigger_type  TEXT NOT NULL,
  allowed_roles TEXT NOT NULL,
  version       INTEGER NOT NULL DEFAULT 1,
  published_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  published_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS runs (
  id            TEXT PRIMARY KEY,
  event_key     TEXT NOT NULL,
  workflow_name TEXT NOT NULL,
  label         TEXT NOT NULL DEFAULT '',
  user_id       TEXT REFERENCES users(id) ON DELETE SET NULL,
  -- Runs of workflows that call an AI Agent; AI Activity and Analytics count only these.
  ai            BOOLEAN NOT NULL DEFAULT false,
  status        TEXT NOT NULL,
  error         TEXT,
  duration_ms   INTEGER,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS runs_user_started ON runs (user_id, started_at DESC);

CREATE TABLE IF NOT EXISTS run_nodes (
  run_id      TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  node_id     TEXT NOT NULL,
  type        TEXT NOT NULL,
  status      TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  error       TEXT,
  output      JSONB,
  -- Execution order, so AI Activity can replay a run step by step.
  seq         SERIAL,
  PRIMARY KEY (run_id, node_id)
);
ALTER TABLE run_nodes ADD COLUMN IF NOT EXISTS seq SERIAL;

-- An FDE's workflow version waiting for (or decided by) the tenant admin. Approving publishes it.
CREATE TABLE IF NOT EXISTS workflow_approvals (
  id            TEXT PRIMARY KEY,
  event_key     TEXT NOT NULL,
  name          TEXT NOT NULL,
  workflow      JSONB NOT NULL,
  note          TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  submitted_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  submitted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  decided_at    TIMESTAMPTZ,
  decision_note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS workflow_approvals_status ON workflow_approvals (status, submitted_at DESC);

-- Models the tenant admin has authorized. model_key is what the AI Agent node stores (provider:model-id).
-- Seeded from config/models.json on server start; the admin can disable, deprecate or add entries.
CREATE TABLE IF NOT EXISTS tenant_models (
  model_key  TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  provider   TEXT NOT NULL,
  version    TEXT NOT NULL DEFAULT 'latest',
  data_class TEXT NOT NULL DEFAULT 'Internal',
  region     TEXT NOT NULL DEFAULT 'India',
  status     TEXT NOT NULL DEFAULT 'authorized' CHECK (status IN ('authorized', 'requested', 'deprecated', 'disabled')),
  note       TEXT NOT NULL DEFAULT '',
  -- 'hosted' = a provider in config/models.json; 'selfhosted' = your own OpenAI-compatible
  -- endpoint (Ollama, vLLM, TGI…). base_url is that endpoint; secrets are never stored here,
  -- api_key_env names an environment variable the server reads at run time.
  kind        TEXT NOT NULL DEFAULT 'hosted' CHECK (kind IN ('hosted', 'selfhosted')),
  base_url    TEXT NOT NULL DEFAULT '',
  api_key_env TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE tenant_models ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'hosted';
ALTER TABLE tenant_models ADD COLUMN IF NOT EXISTS base_url TEXT NOT NULL DEFAULT '';
ALTER TABLE tenant_models ADD COLUMN IF NOT EXISTS api_key_env TEXT NOT NULL DEFAULT '';

-- One row per policy check; the tenant admin picks the action and every workflow run reads it live.
CREATE TABLE IF NOT EXISTS guardrail_policies (
  check_key  TEXT PRIMARY KEY,
  label      TEXT NOT NULL,
  action     TEXT NOT NULL CHECK (action IN ('block', 'block_page_admin', 'mask_log', 'warn', 'log')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT
);
INSERT INTO guardrail_policies (check_key, label, action) VALUES
  ('pii',                'PII and Aadhaar / PAN detection',          'mask_log'),
  ('injection',          'Prompt injection in retrieved content',    'block'),
  ('unauthorized_write', 'Write to business system without approval','block_page_admin'),
  ('ungrounded',         'Answer without a source',                  'warn'),
  ('offtopic',           'Off-topic for workflow scope',             'warn'),
  ('token_spike',        'Token use over 3x usual',                  'log')
ON CONFLICT (check_key) DO NOTHING;

-- What a policy check actually did on a run. Open events are the admin's alert queue;
-- per-run events surface in the end user's AI Activity page.
CREATE TABLE IF NOT EXISTS guardrail_events (
  id         TEXT PRIMARY KEY,
  run_id     TEXT,
  user_id    TEXT,
  event_key  TEXT,
  check_key  TEXT NOT NULL,
  action     TEXT NOT NULL,
  severity   TEXT NOT NULL,
  title      TEXT NOT NULL,
  detail     TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS guardrail_events_run ON guardrail_events (run_id);
CREATE INDEX IF NOT EXISTS guardrail_events_status ON guardrail_events (status, created_at DESC);

-- Systems agents may read from / write to. auth 'user_consent' means each end user is asked
-- before an agent touches their data; toggles and consent changes are audited.
CREATE TABLE IF NOT EXISTS connectors (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('connector', 'mcp')),
  auth           TEXT NOT NULL CHECK (auth IN ('service_account', 'user_consent')),
  scope          TEXT NOT NULL DEFAULT '',
  -- Plain-words reason shown to end users on My data access ("why the assistants read this").
  purpose        TEXT NOT NULL DEFAULT '',
  business_units TEXT NOT NULL DEFAULT '',
  enabled        BOOLEAN NOT NULL DEFAULT true,
  health         TEXT NOT NULL DEFAULT 'Healthy',
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE connectors ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT '';
INSERT INTO connectors (id, name, kind, auth, scope, business_units, enabled, health) VALUES
  ('sharepoint',     'SharePoint',            'connector', 'user_consent',    'Documents library (read)',            'All teams', true,  'Healthy'),
  ('qdrant',         'Qdrant vector store',   'connector', 'service_account', 'Document embeddings (read, write)',   'All teams', true,  'Healthy'),
  ('database',       'Project database',      'connector', 'service_account', 'Projects, milestones (read)',         'Delivery',  true,  'Healthy'),
  ('websearch',      'Web search',            'mcp',       'service_account', 'Search (read)',                       'All teams', true,  'Healthy'),
  ('sharepoint-mcp', 'SharePoint MCP server', 'mcp',       'user_consent',    'Document reads for chat and reports', 'All teams', true,  'Healthy')
ON CONFLICT (id) DO NOTHING;
-- The Manzil chat/report workflows read through the SharePoint MCP server; an early seed
-- shipped it disabled, which blocked those features. Re-enable unless an admin acted on it since.
UPDATE connectors SET enabled = true, health = 'Healthy', scope = 'Document reads for chat and reports', business_units = 'All teams'
 WHERE id = 'sharepoint-mcp' AND enabled = false AND health = 'Awaiting review';
UPDATE connectors SET purpose = CASE id
  WHEN 'sharepoint'     THEN 'To read project documents you can already open, so answers can cite them'
  WHEN 'qdrant'         THEN 'To find the most relevant passages in indexed documents when answering'
  WHEN 'database'       THEN 'To look up project and milestone records referenced in answers'
  WHEN 'websearch'      THEN 'To look up public information when an answer needs it'
  WHEN 'sharepoint-mcp' THEN 'To run SharePoint operations through the MCP server'
  ELSE purpose END
WHERE purpose = '';

-- An end user's own switch over user-consent connectors. No row means allowed;
-- turning one off takes effect on their very next run.
CREATE TABLE IF NOT EXISTS user_consents (
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connector_id TEXT NOT NULL REFERENCES connectors(id) ON DELETE CASCADE,
  allowed      BOOLEAN NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, connector_id)
);

-- Evaluation cases an FDE keeps against a workflow: a sample payload and what the
-- answer must contain. Run from the builder's Evaluations tab before submitting.
CREATE TABLE IF NOT EXISTS evaluation_cases (
  id              TEXT PRIMARY KEY,
  event_key       TEXT NOT NULL,
  name            TEXT NOT NULL,
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  expect_contains TEXT NOT NULL DEFAULT '',
  last_status     TEXT NOT NULL DEFAULT 'not_run' CHECK (last_status IN ('not_run', 'passed', 'failed')),
  last_detail     TEXT NOT NULL DEFAULT '',
  last_run_at     TIMESTAMPTZ,
  created_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS evaluation_cases_event ON evaluation_cases (event_key, created_at);

-- Every approval, publish, consent change and agent action.
CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGSERIAL PRIMARY KEY,
  actor_id    TEXT,
  actor_email TEXT,
  action      TEXT NOT NULL,
  subject     TEXT NOT NULL DEFAULT '',
  detail      TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_created ON audit_log (created_at DESC);

CREATE TABLE IF NOT EXISTS chat_messages (
  id         SERIAL PRIMARY KEY,
  session_id TEXT NOT NULL,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content    TEXT NOT NULL,
  ui         JSONB,
  run_id     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_messages_session ON chat_messages (session_id, id);
