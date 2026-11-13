-- Audio becomes a first-class saved asset, and an editable composition can be
-- rendered into an assembled result.
--
-- SQLite cannot widen a CHECK constraint in place, and this database enforces
-- foreign keys. The parent table is therefore renamed first, so the child
-- tables' references follow it; the children are then rebuilt against the new
-- parent and the old parent is dropped last. Every row and every relationship
-- is copied, and the self-referencing parent is restored in a second pass so
-- insertion order cannot fail the copy.

ALTER TABLE assets RENAME TO assets_old;

CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  kind TEXT NOT NULL CHECK (kind IN ('image', 'video', 'audio')),
  r2_key TEXT NOT NULL,
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  duration_ms INTEGER,
  sample_rate INTEGER,
  channels INTEGER,
  sha256 TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  caption TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL CHECK (source IN ('upload', 'generated', 'variant', 'assembled')),
  parent_asset_id TEXT REFERENCES assets(id),
  generation_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  delete_revision INTEGER NOT NULL DEFAULT 1
);

INSERT INTO assets (
  id, project_id, kind, r2_key, mime, bytes, width, height, duration_ms,
  sample_rate, channels, sha256, title, caption, source, parent_asset_id,
  generation_id, created_at, updated_at, deleted_at, delete_revision
)
SELECT
  id, project_id, kind, r2_key, mime, bytes, width, height, duration_ms,
  NULL, NULL, sha256, title, caption, source, NULL,
  generation_id, created_at, updated_at, deleted_at, delete_revision
FROM assets_old;

UPDATE assets
SET parent_asset_id = (SELECT old.parent_asset_id FROM assets_old old WHERE old.id = assets.id)
WHERE EXISTS (
  SELECT 1 FROM assets_old old WHERE old.id = assets.id AND old.parent_asset_id IS NOT NULL
);

CREATE INDEX IF NOT EXISTS assets_project_created ON assets(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS assets_project_live ON assets(project_id, deleted_at);
CREATE UNIQUE INDEX IF NOT EXISTS assets_generation ON assets(generation_id) WHERE generation_id IS NOT NULL;

CREATE TABLE generations_next (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  composition_id TEXT,
  client_request_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('image', 'video', 'audio')),
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

INSERT INTO generations_next (
  id, project_id, client_request_id, kind, recipe_id, provider, model, model_version,
  request_json, provider_request_id, provider_status_url, provider_response_url, status,
  error_code, error_detail, retained_key, retained_mime, retained_bytes, output_asset_id,
  cost_estimate_micro, cost_reserved_micro, cost_observed_micro, created_at, updated_at,
  submitted_at, completed_at, cancelled_at, deleted_at, delete_revision
)
SELECT
  id, project_id, client_request_id, kind, recipe_id, provider, model, model_version,
  request_json, provider_request_id, provider_status_url, provider_response_url, status,
  error_code, error_detail, retained_key, retained_mime, retained_bytes, output_asset_id,
  cost_estimate_micro, cost_reserved_micro, cost_observed_micro, created_at, updated_at,
  submitted_at, completed_at, cancelled_at, deleted_at, delete_revision
FROM generations;

DROP TABLE generations;
ALTER TABLE generations_next RENAME TO generations;

CREATE INDEX IF NOT EXISTS generations_project_created ON generations(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS generations_pending ON generations(status) WHERE status IN ('submitting', 'submitted', 'running', 'provider_complete', 'saving');
CREATE INDEX IF NOT EXISTS generations_composition ON generations(composition_id);

CREATE TABLE publications_next (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  asset_id TEXT NOT NULL REFERENCES assets(id),
  poster_asset_id TEXT REFERENCES assets(id),
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  asset_revision INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER,
  hidden INTEGER NOT NULL DEFAULT 0
);

INSERT INTO publications_next (
  id, project_id, asset_id, poster_asset_id, slug, title, description,
  asset_revision, created_at, revoked_at, hidden
)
SELECT
  id, project_id, asset_id, poster_asset_id, slug, title, description,
  asset_revision, created_at, revoked_at, hidden
FROM publications;

DROP TABLE publications;
ALTER TABLE publications_next RENAME TO publications;

CREATE INDEX IF NOT EXISTS publications_asset ON publications(asset_id);

DROP TABLE assets_old;

CREATE TABLE IF NOT EXISTS compositions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  title TEXT NOT NULL,
  spec_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS compositions_project ON compositions(project_id, created_at DESC);
