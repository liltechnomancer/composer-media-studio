-- Media Studio schema. One app-owned D1 database; media bytes live in R2.
-- Money is integer micro-USD (1 dollar = 1,000,000). Nothing here is a price list.

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  creative_direction TEXT NOT NULL DEFAULT '',
  references_json TEXT NOT NULL DEFAULT '[]',
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'unlisted')),
  defaults_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  kind TEXT NOT NULL CHECK (kind IN ('image', 'video')),
  r2_key TEXT NOT NULL,
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  duration_ms INTEGER,
  sha256 TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  caption TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL CHECK (source IN ('upload', 'generated', 'variant')),
  parent_asset_id TEXT REFERENCES assets(id),
  generation_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  delete_revision INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS assets_project_created ON assets(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS assets_project_live ON assets(project_id, deleted_at);

CREATE TABLE IF NOT EXISTS generations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  client_request_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('image', 'video')),
  recipe_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  model_version TEXT NOT NULL DEFAULT '',
  request_json TEXT NOT NULL,
  provider_request_id TEXT,
  provider_status_url TEXT,
  provider_response_url TEXT,
  status TEXT NOT NULL CHECK (status IN (
    'admitted', 'submitting', 'submitted', 'running', 'provider_complete',
    'saving', 'saved', 'failed', 'cancel_requested', 'cancelled', 'unknown',
    'discarded_after_delete'
  )),
  error_code TEXT,
  error_detail TEXT,
  retained_key TEXT,
  retained_mime TEXT,
  retained_bytes INTEGER,
  output_asset_id TEXT REFERENCES assets(id),
  cost_estimate_micro INTEGER NOT NULL,
  cost_reserved_micro INTEGER NOT NULL,
  cost_observed_micro INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  submitted_at INTEGER,
  completed_at INTEGER,
  cancelled_at INTEGER,
  deleted_at INTEGER,
  delete_revision INTEGER NOT NULL DEFAULT 1,
  UNIQUE (project_id, client_request_id)
);
CREATE INDEX IF NOT EXISTS generations_project_created ON generations(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS generations_pending ON generations(status) WHERE status IN ('submitting', 'submitted', 'running', 'provider_complete', 'saving');
CREATE UNIQUE INDEX IF NOT EXISTS assets_generation ON assets(generation_id) WHERE generation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS budgets (
  project_id TEXT NOT NULL REFERENCES projects(id),
  period TEXT NOT NULL,
  allowance_micro INTEGER NOT NULL,
  reserved_micro INTEGER NOT NULL DEFAULT 0,
  spent_micro INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, period)
);

CREATE TABLE IF NOT EXISTS recipes (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id),
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('image', 'video')),
  prompt_template TEXT NOT NULL,
  controls_json TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  UNIQUE (project_id, slug)
);

CREATE TABLE IF NOT EXISTS publications (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  asset_id TEXT NOT NULL REFERENCES assets(id),
  poster_asset_id TEXT REFERENCES assets(id),
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  asset_revision INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS publications_asset ON publications(asset_id);

CREATE TABLE IF NOT EXISTS login_attempts (
  ip TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  reset_at INTEGER NOT NULL
);
