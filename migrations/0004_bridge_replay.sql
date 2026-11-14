-- A Composer handoff is single-use. The jti is recorded before a studio
-- session is minted, so replaying a captured bridge URL within its two-minute
-- window is refused. Expired rows can be removed opportunistically.
CREATE TABLE IF NOT EXISTS bridge_handoffs (
  jti TEXT PRIMARY KEY,
  expires INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS bridge_handoffs_expires ON bridge_handoffs(expires);
