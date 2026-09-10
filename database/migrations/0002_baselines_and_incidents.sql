-- Sentinel Forge — baseline detail and incident correlation.
--
-- Schema 1 created the `baselines`, `performance_samples`, `incidents` and
-- `incident_events` tables. This migration adds what a baseline needs to be
-- comparable: the resource inventory and the findings as they stood when the
-- baseline was taken.
--
-- Without those, "compare two baselines" could only compare aggregate counts,
-- which is enough to say something changed and useless for saying what.

PRAGMA foreign_keys = ON;

-- Resource inventory at the moment a baseline was captured -------------------

CREATE TABLE baseline_resources (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  baseline_id   TEXT NOT NULL REFERENCES baselines (id) ON DELETE CASCADE,
  resource_name TEXT NOT NULL,
  path          TEXT NOT NULL,
  -- Declared version, NULL when the manifest declares none. Never inferred.
  version       TEXT,
  file_count    INTEGER NOT NULL,
  total_bytes   INTEGER NOT NULL,
  -- Hash over the resource's file inventory: path, size and content hash of
  -- every file. Two resources with this value equal are byte-identical.
  content_hash  TEXT NOT NULL
) STRICT;

CREATE UNIQUE INDEX idx_baseline_resources_unique ON baseline_resources (baseline_id, resource_name);

-- Findings as they stood when a baseline was captured ------------------------
--
-- Stored separately from `findings` rather than referencing it: a finding row
-- belongs to a scan run and is updated when the same finding is seen again,
-- whereas a baseline must keep what was true at capture time even after later
-- scans move on.

CREATE TABLE baseline_findings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  baseline_id   TEXT NOT NULL REFERENCES baselines (id) ON DELETE CASCADE,
  finding_id    TEXT NOT NULL,
  rule_id       TEXT NOT NULL,
  severity      TEXT NOT NULL,
  confidence    REAL NOT NULL,
  resource_name TEXT,
  file_path     TEXT,
  line          INTEGER,
  title         TEXT NOT NULL
) STRICT;

CREATE UNIQUE INDEX idx_baseline_findings_unique ON baseline_findings (baseline_id, finding_id);
CREATE INDEX idx_baseline_findings_rule ON baseline_findings (baseline_id, rule_id);

-- Health score recorded with a baseline, so a comparison can show the score
-- moving without recomputing it from findings that may no longer exist.
ALTER TABLE baselines ADD COLUMN health_score INTEGER;
ALTER TABLE baselines ADD COLUMN finding_count INTEGER NOT NULL DEFAULT 0;
