-- D1 schema for the drift worker. Idempotent; applied with `drift worker migrate`.
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,              -- ISO timestamp
  type TEXT NOT NULL,            -- pageview | listing_view | click_call | click_ksl | click_carfax | contact_submit
  path TEXT NOT NULL DEFAULT '',
  listing_id TEXT NOT NULL DEFAULT '',
  referrer TEXT NOT NULL DEFAULT '',   -- referrer host, '' for direct
  country TEXT NOT NULL DEFAULT '',
  region TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  ip TEXT NOT NULL DEFAULT '',          -- raw IP only when IP_MODE=full
  ip_hash TEXT NOT NULL DEFAULT '',
  device TEXT NOT NULL DEFAULT '',      -- mobile | tablet | desktop
  session_id TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS events_ts ON events (ts);
CREATE INDEX IF NOT EXISTS events_type_ts ON events (type, ts);
CREATE INDEX IF NOT EXISTS events_listing ON events (listing_id, ts);
CREATE INDEX IF NOT EXISTS events_iphash_ts ON events (ip_hash, ts);

CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL,
  listing_id TEXT NOT NULL DEFAULT '',
  listing_title TEXT NOT NULL DEFAULT '',
  page TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  ip TEXT NOT NULL DEFAULT '',
  ip_hash TEXT NOT NULL DEFAULT '',
  delivered TEXT NOT NULL DEFAULT '',   -- comma list: telegram,email  (what actually succeeded)
  errors TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS leads_ts ON leads (ts);
CREATE INDEX IF NOT EXISTS leads_iphash_ts ON leads (ip_hash, ts);

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  type TEXT NOT NULL,            -- sync | digest | deploy | test
  status TEXT NOT NULL,          -- ok | error
  summary TEXT NOT NULL DEFAULT '{}'  -- JSON
);
CREATE INDEX IF NOT EXISTS jobs_ts ON jobs (ts);
