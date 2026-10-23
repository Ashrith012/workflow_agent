-- Idempotent schema; applied on every server start (server/db/index.ts).

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin', 'user')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

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
  PRIMARY KEY (run_id, node_id)
);

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
