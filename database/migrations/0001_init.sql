-- Sentinel Forge — initial local schema.
--
-- Scope: everything Sentinel Forge records stays on the operator's machine.
-- No table in this schema is designed for transmission to a remote service.
--
-- Conventions
--   * Timestamps are ISO-8601 strings in UTC (TEXT), so rows stay readable and
--     comparable with report output without a conversion step.
--   * Identifiers are the deterministic/random ids produced by `core/ids.ts`.
--   * Deleting a server cascades to everything recorded about it, which is what
--     `sentinel purge` relies on.
--   * No column in this schema stores a raw secret value. Evidence excerpts are
--     redacted before insertion (see core/logging/redaction.ts).

PRAGMA foreign_keys = ON;

-- Scanned servers ------------------------------------------------------------

CREATE TABLE servers (
  id             TEXT PRIMARY KEY,
  path           TEXT NOT NULL,
  config_path    TEXT,
  fingerprint    TEXT NOT NULL,
  first_seen_at  TEXT NOT NULL,
  last_seen_at   TEXT NOT NULL
) STRICT;

CREATE UNIQUE INDEX idx_servers_path ON servers (path);

-- One execution of a scanning command ----------------------------------------

CREATE TABLE scan_runs (
  id                TEXT PRIMARY KEY,
  server_id         TEXT NOT NULL REFERENCES servers (id) ON DELETE CASCADE,
  command           TEXT NOT NULL,
  product_version   TEXT NOT NULL,
  started_at        TEXT NOT NULL,
  finished_at       TEXT,
  -- RUNNING | COMPLETED | FAILED
  status            TEXT NOT NULL,
  duration_ms       INTEGER,
  resource_count    INTEGER,
  finding_count     INTEGER,
  -- Reason analysis was incomplete (traversal limit hit, unreadable paths).
  incomplete_reason TEXT
) STRICT;

CREATE INDEX idx_scan_runs_server_started ON scan_runs (server_id, started_at DESC);

-- Discovered resources -------------------------------------------------------

CREATE TABLE resources (
  id            TEXT PRIMARY KEY,
  server_id     TEXT NOT NULL REFERENCES servers (id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  path          TEXT NOT NULL,
  -- fxmanifest | __resource | none
  manifest_kind TEXT NOT NULL,
  -- Declared version; NULL when the manifest declares none. Never inferred.
  version       TEXT,
  file_count    INTEGER NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL
) STRICT;

CREATE UNIQUE INDEX idx_resources_server_name ON resources (server_id, name);

CREATE TABLE resource_files (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  resource_id   TEXT NOT NULL REFERENCES resources (id) ON DELETE CASCADE,
  path          TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL,
  hash          TEXT NOT NULL,
  hash_algorithm TEXT NOT NULL DEFAULT 'sha256',
  modified_at   TEXT NOT NULL,
  file_type     TEXT NOT NULL,
  recorded_at   TEXT NOT NULL
) STRICT;

CREATE UNIQUE INDEX idx_resource_files_resource_path ON resource_files (resource_id, path);

-- Dependency graph edges -----------------------------------------------------

CREATE TABLE dependencies (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id     TEXT NOT NULL REFERENCES servers (id) ON DELETE CASCADE,
  from_resource TEXT NOT NULL,
  to_resource   TEXT NOT NULL,
  -- DECLARED | DISCOVERED | OPTIONAL
  kind          TEXT NOT NULL,
  resolved      INTEGER NOT NULL,
  declared_in   TEXT,
  recorded_at   TEXT NOT NULL
) STRICT;

CREATE UNIQUE INDEX idx_dependencies_edge ON dependencies (server_id, from_resource, to_resource, kind);

-- Findings -------------------------------------------------------------------

CREATE TABLE findings (
  id             TEXT PRIMARY KEY,
  scan_run_id    TEXT NOT NULL REFERENCES scan_runs (id) ON DELETE CASCADE,
  server_id      TEXT NOT NULL REFERENCES servers (id) ON DELETE CASCADE,
  rule_id        TEXT NOT NULL,
  category       TEXT NOT NULL,
  -- INFO | LOW | MEDIUM | HIGH | CRITICAL
  severity       TEXT NOT NULL,
  -- 0.00-1.00
  confidence     REAL NOT NULL,
  title          TEXT NOT NULL,
  summary        TEXT NOT NULL,
  recommendation TEXT NOT NULL,
  resource_name  TEXT,
  file_path      TEXT,
  line           INTEGER,
  -- JSON array of evidence records, already redacted.
  evidence_json  TEXT NOT NULL,
  metadata_json  TEXT,
  created_at     TEXT NOT NULL
) STRICT;

CREATE INDEX idx_findings_run ON findings (scan_run_id);
CREATE INDEX idx_findings_server_rule ON findings (server_id, rule_id);
CREATE INDEX idx_findings_severity ON findings (server_id, severity);

-- Security-specific attributes for a finding in the SECURITY category.
-- Separate from `findings` so security metadata can evolve without changing the
-- shape of every other finding, and so security data can be purged on its own.
CREATE TABLE security_findings (
  finding_id       TEXT PRIMARY KEY REFERENCES findings (id) ON DELETE CASCADE,
  -- SECRET | WEBHOOK | OBFUSCATION | REMOTE_LOAD | DYNAMIC_EXEC | SUSPICIOUS_FILE
  indicator_type   TEXT NOT NULL,
  -- Always redacted. A raw secret is never written to this column.
  redacted_excerpt TEXT,
  requires_manual_review INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT NOT NULL
) STRICT;

-- Performance ----------------------------------------------------------------

CREATE TABLE baselines (
  id                    TEXT PRIMARY KEY,
  server_id             TEXT NOT NULL REFERENCES servers (id) ON DELETE CASCADE,
  label                 TEXT NOT NULL,
  server_fingerprint    TEXT NOT NULL,
  config_fingerprint    TEXT,
  resource_count        INTEGER NOT NULL,
  -- Player count at capture time; NULL when unavailable. Never estimated.
  player_count          INTEGER,
  sample_count          INTEGER NOT NULL DEFAULT 0,
  notes                 TEXT,
  created_at            TEXT NOT NULL
) STRICT;

CREATE UNIQUE INDEX idx_baselines_server_label ON baselines (server_id, label);

CREATE TABLE performance_samples (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id     TEXT NOT NULL REFERENCES servers (id) ON DELETE CASCADE,
  baseline_id   TEXT REFERENCES baselines (id) ON DELETE CASCADE,
  resource_name TEXT NOT NULL,
  -- Measured value and its unit; no derived or interpolated values are stored.
  metric        TEXT NOT NULL,
  value         REAL NOT NULL,
  unit          TEXT NOT NULL,
  player_count  INTEGER,
  sampled_at    TEXT NOT NULL,
  -- Which collector produced the sample, so provenance stays auditable.
  source        TEXT NOT NULL
) STRICT;

CREATE INDEX idx_perf_samples_lookup ON performance_samples (server_id, resource_name, sampled_at DESC);
CREATE INDEX idx_perf_samples_baseline ON performance_samples (baseline_id);

-- Integrity ------------------------------------------------------------------

CREATE TABLE integrity_snapshots (
  id             TEXT PRIMARY KEY,
  server_id      TEXT NOT NULL REFERENCES servers (id) ON DELETE CASCADE,
  label          TEXT,
  file_count     INTEGER NOT NULL,
  total_bytes    INTEGER NOT NULL,
  -- Hash over the whole snapshot, for cheap equality checks.
  snapshot_hash  TEXT NOT NULL,
  created_at     TEXT NOT NULL
) STRICT;

CREATE TABLE integrity_entries (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_id   TEXT NOT NULL REFERENCES integrity_snapshots (id) ON DELETE CASCADE,
  resource_name TEXT,
  path          TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL,
  hash          TEXT NOT NULL,
  modified_at   TEXT NOT NULL,
  file_type     TEXT NOT NULL
) STRICT;

CREATE UNIQUE INDEX idx_integrity_entries_snapshot_path ON integrity_entries (snapshot_id, path);

-- Incidents ------------------------------------------------------------------

CREATE TABLE incidents (
  id                  TEXT PRIMARY KEY,
  server_id           TEXT NOT NULL REFERENCES servers (id) ON DELETE CASCADE,
  started_at          TEXT NOT NULL,
  ended_at            TEXT,
  severity            TEXT NOT NULL,
  -- 0.00-1.00 confidence that the correlated signals are related.
  confidence          REAL NOT NULL,
  summary             TEXT NOT NULL,
  -- JSON array of resource names observed in the incident window.
  affected_resources_json TEXT NOT NULL,
  created_at          TEXT NOT NULL
) STRICT;

CREATE INDEX idx_incidents_server_time ON incidents (server_id, started_at DESC);

CREATE TABLE incident_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_id  TEXT NOT NULL REFERENCES incidents (id) ON DELETE CASCADE,
  occurred_at  TEXT NOT NULL,
  -- RESOURCE_RESTART | FILE_CHANGE | PERFORMANCE_CHANGE | ERROR_SPIKE | FINDING | CONFIG_CHANGE
  event_type   TEXT NOT NULL,
  resource_name TEXT,
  description  TEXT NOT NULL,
  -- Optional link to the finding that produced this timeline entry.
  finding_id   TEXT REFERENCES findings (id) ON DELETE SET NULL,
  metadata_json TEXT
) STRICT;

CREATE INDEX idx_incident_events_incident ON incident_events (incident_id, occurred_at);
