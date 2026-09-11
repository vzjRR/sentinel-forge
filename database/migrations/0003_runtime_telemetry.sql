-- Sentinel Forge — runtime telemetry ingestion.
--
-- Schema 1 created `performance_samples`, which has been waiting since GATE 3
-- for something to measure the server. GATE 5 supplies it: the `sentinel_doctor`
-- collector writes telemetry files, and `sentinel runtime import` reads them.
--
-- Two things the sample table cannot express are added here.
--
-- First, **ingestion has to be idempotent**. The collector writes into a fixed
-- rotation of files, so the same document is seen again on every import until
-- it is overwritten. Without a record of what has already been read, a nightly
-- import would multiply every sample and quietly corrupt the statistics the
-- regression engine draws from them. `runtime_ingest_files` records the digest
-- of each document that has been read, and a document whose digest is already
-- present is skipped.
--
-- Second, **the collector observes events, not only samples**: resources
-- starting and stopping, and their state as first seen. Those are observations
-- of the running server, distinct from the incident rows that GATE 4 derives
-- from comparing baselines, and they are kept apart from them so that "what the
-- server did" is never confused with "what Sentinel Forge inferred".

PRAGMA foreign_keys = ON;

-- Documents already read ------------------------------------------------------

CREATE TABLE runtime_ingest_files (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id      TEXT NOT NULL REFERENCES servers (id) ON DELETE CASCADE,
  -- Server-relative path of the telemetry file, for reporting where a document
  -- came from. Not unique: the collector rotates through a fixed set of names.
  path           TEXT NOT NULL,
  -- Digest over the document's identifying content. Two documents with this
  -- value equal carry the same measurements and are imported once.
  digest         TEXT NOT NULL,
  collector      TEXT NOT NULL,
  -- Version the collector declared, NULL when it declared none. Never inferred.
  collector_version TEXT,
  schema_version TEXT NOT NULL,
  -- What the document contained, so an import can be described after the fact
  -- without re-reading the file.
  sample_count   INTEGER NOT NULL,
  event_count    INTEGER NOT NULL,
  -- What the collector reported dropping because a buffer was full. A gap in
  -- the data is recorded as a gap, not presented as a quiet period.
  dropped_samples INTEGER NOT NULL DEFAULT 0,
  dropped_events  INTEGER NOT NULL DEFAULT 0,
  -- When the collector wrote the file, and when Sentinel Forge read it.
  written_at     TEXT,
  imported_at    TEXT NOT NULL
) STRICT;

CREATE UNIQUE INDEX idx_runtime_ingest_digest ON runtime_ingest_files (server_id, digest);
CREATE INDEX idx_runtime_ingest_imported ON runtime_ingest_files (server_id, imported_at DESC);

-- Events observed by the collector -------------------------------------------
--
-- `incident_events` belongs to an incident Sentinel Forge inferred. These rows
-- are the opposite: things the server was observed to do, recorded with no
-- interpretation attached.

CREATE TABLE runtime_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id     TEXT NOT NULL REFERENCES servers (id) ON DELETE CASCADE,
  ingest_id     INTEGER NOT NULL REFERENCES runtime_ingest_files (id) ON DELETE CASCADE,
  -- What was observed: resource_started, resource_stopped, resource_state,
  -- resource_state_changed. Stored as the collector reported it; this build
  -- does not rewrite an event kind it does not recognise.
  kind          TEXT NOT NULL,
  -- The resource the event concerns, NULL when the event concerns the server.
  resource_name TEXT,
  -- Free text supplied by the collector, such as the resource state observed.
  detail        TEXT,
  -- Player count at the moment of observation. A count only: no identifier,
  -- name, endpoint or position is collected or stored anywhere.
  player_count  INTEGER,
  observed_at   TEXT NOT NULL,
  source        TEXT NOT NULL
) STRICT;

CREATE INDEX idx_runtime_events_lookup ON runtime_events (server_id, observed_at DESC);
CREATE INDEX idx_runtime_events_resource ON runtime_events (server_id, resource_name, observed_at DESC);
