-- OAuth clients, one-use authorization codes and scoped token hashes.
CREATE TABLE IF NOT EXISTS mcp_clients (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, redirect_uris_json TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS mcp_registration_limits (
  ip_hash TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS mcp_registration_limits_reset ON mcp_registration_limits(reset_at);
CREATE TABLE IF NOT EXISTS mcp_codes (
  hash TEXT PRIMARY KEY, client_id TEXT NOT NULL, redirect_uri TEXT NOT NULL,
  challenge TEXT NOT NULL, resource TEXT NOT NULL, project_id TEXT NOT NULL,
  issuer_json TEXT NOT NULL, scopes TEXT NOT NULL, spend_cap_micro INTEGER NOT NULL DEFAULT 0, expires_at INTEGER NOT NULL, used_at INTEGER
);
CREATE TABLE IF NOT EXISTS mcp_tokens (
  hash TEXT PRIMARY KEY, id TEXT NOT NULL UNIQUE, client_id TEXT NOT NULL,
  resource TEXT NOT NULL, project_id TEXT NOT NULL, issuer_json TEXT NOT NULL, scopes TEXT NOT NULL, spend_cap_micro INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS mcp_tokens_project ON mcp_tokens(project_id, revoked_at);
CREATE TABLE IF NOT EXISTS mcp_spend_reservations (
  token_id TEXT NOT NULL, request_id TEXT NOT NULL, fingerprint TEXT NOT NULL,
  estimate_micro INTEGER NOT NULL CHECK (estimate_micro>=0), created_at INTEGER NOT NULL,
  PRIMARY KEY(token_id, request_id)
);
CREATE INDEX IF NOT EXISTS mcp_codes_expiry ON mcp_codes(expires_at);
CREATE INDEX IF NOT EXISTS mcp_tokens_expiry ON mcp_tokens(expires_at);
CREATE INDEX IF NOT EXISTS mcp_clients_age ON mcp_clients(created_at);
