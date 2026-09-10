# Changelog

All notable changes to Sentinel Forge are recorded here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
the project uses [Semantic Versioning](https://semver.org/).

© 2026 Talal Al Ghafri. All Rights Reserved.

## [0.4.0] — GATE 3: Performance intelligence

Sentinel Forge can now answer "what changed, and what followed" — the question
an operator actually asks when a server starts behaving differently.

### Added

- **`@sentinel-forge/performance`**: sample statistics (mean, median, p95,
  standard deviation, coefficient of variation); regression detection with
  absolute and relative thresholds, minimum sample counts, a baseline-noise
  check and an optional player-count context check; baselines recording resource
  content hashes, configuration fingerprint, findings and health; and sample
  storage with provenance.
- **`@sentinel-forge/incidents`**: change correlation and incident timelines,
  with confidence built from shared resource, temporal proximity and ordering.
- **Retention and purge**: policy-driven expiry per record type, a full-delete
  scope, and per-table storage reporting. Purge is a dry run unless `--confirm`
  is passed.
- **Commands** `sentinel baseline`, `compare`, `incidents` and `purge`.
- **Rule** `PERF-REGRESSION-001`.
- **Database schema 2**: `baseline_resources`, `baseline_findings`, and health
  and finding counts on `baselines`.
- **`--confirm`** as a documented global flag for destructive operations.

### The constraint this gate was built around

No runtime collector exists before GATE 5, so nothing measures resource timing
yet. Rather than estimate a number:

- a baseline records what genuinely exists — content hashes, configuration
  fingerprint, findings, health — and reports a sample count of zero;
- `compare` states that performance was not compared, and why. A quietly omitted
  section would read as "no regressions found", which is a different claim from
  "nothing was measured";
- the regression engine is complete and fully tested against supplied samples,
  ready for a source.

### Guarding the claim

Correlation confidence is capped at 0.85 and regression confidence at 0.9,
because neither establishes a cause. Every correlation carries the reasons behind
its number, and tests assert that incident and regression wording never contains
"caused by".

### Fixed

- Sample reads ordered by timestamp alone were non-deterministic when a
  collector records several samples in the same millisecond. Ordering now breaks
  the tie on row id, so two runs summarise identical data identically.

## [0.3.0] — GATE 2: Diagnostic engine

Sentinel Forge now diagnoses, not just inventories: it analyses Lua source
without executing it and produces an explainable health score where every point
deducted names the finding that caused it.

### Added

- **`@sentinel-forge/lua`**: the full Lua 5.4 lexical grammar and a block
  structure model. Shared with manifest parsing so the two cannot drift apart on
  what a Lua string or comment is.
- **`@sentinel-forge/analyzer`**: script analysis (loops with continuity, yield
  state and wait interval; thread bodies; event registrations and triggers with
  direction and broadcast detection; database calls with statement
  classification), the cross-resource event graph, and health scoring.
- **`@sentinel-forge/engine`**: the scan pipeline, extracted so the scanner does
  not depend on the analyzer and so the dashboard and MCP server can run the
  same analysis rather than a variation of it.
- **Rules** `PERF-LOOP-001`, `PERF-EVENT-001` and `PERF-QUERY-001`.
- **Commands** `sentinel health` and `sentinel resource <name>`.
- **Health scoring**: deductions weighted by confidence, per-category scores,
  normalized weighting across scored categories, documented caps, and any
  category without analysis behind it reported as unavailable rather than given
  a value. Point values, weights and caps are documented in `docs/API.md`.
- **Workspace wiring test**: adding a package now fails loudly if it is missing
  from the workspace list, the root tsconfig, the test path map or the Vitest
  aliases — the last of which previously failed silently by resolving imports to
  stale build output.

### Changed

- **Report schema 1.1** (additive): optional `events` section and optional
  per-resource `health`. A 1.0 consumer sees the fields it already knows.
- `PERF-QUERY-001`'s description now also covers `SELECT *`, which it reports at
  INFO. The rule's meaning is unchanged.

### Fixed

- A loop-containment off-by-one meant a call on the first line of a loop body
  was treated as outside the loop — which hid exactly the case the query-in-loop
  rule exists to find.
- A negative numeric argument was read as positive, so `TriggerClientEvent(event,
  -1, …)` was not recognised as a broadcast.

### False-positive control

`Wait(0)` is a legitimate per-frame pattern and is never reported by
`PERF-LOOP-001`. The `performance-smell` fixture carries it as a control, and
two tests assert the rule stays silent on it. The generated 500-resource server
in the benchmark is also asserted to produce no findings at all.

### Known limitations

Block structure is not a parse tree; a yield inside a called function is not
followed (confidence drops, and the unfollowed call count is in the evidence);
only literal arguments are read; database detection is framework-specific; only
`.lua` files are analysed. See `docs/GATE_STATUS.md`.

## [0.2.0] — GATE 1: Static scanner

Sentinel Forge can now scan a FiveM server. Five rules run against every scan,
each producing findings with evidence, severity and confidence.

### Added

- **`@sentinel-forge/scanner`**: a Lua lexer and parser for `fxmanifest.lua` and
  `__resource.lua` that never executes the file; a typed manifest model keeping
  every value's source position; glob resolution (`*`, `?`, `**`, `**/`);
  `server.cfg` parsing (`ensure`/`start`/`stop`/`restart`, `set`/`sets`/`setr`,
  `exec`); single-pass server discovery with `[category]` directory support,
  per-file SHA-256 and a server fingerprint; and the scan pipeline.
- **`@sentinel-forge/dependencies`**: dependency graph construction from declared
  dependencies and discovered `@resource/file` references, `provide` resolution,
  and iterative cycle detection with canonical ordering.
- **`@sentinel-forge/reports`**: JSON rendering validated against the published
  schema with canonical key order, and Markdown rendering grouped by severity
  with evidence locations and a limitations section.
- **Commands**: `sentinel scan`, `sentinel dependencies`, `sentinel report`.
- **Storage**: transactional persistence of servers, scan runs, resources,
  resource files, dependencies and findings, keyed so that re-scanning updates
  rather than duplicates.
- **`CFG-ENSURE-MISSING-001`**: new rule for a server configuration that starts a
  resource which was not found.
- **`scripts/check-versions.mjs`**: fails CI when the product version disagrees
  between the workspace manifests and the constant embedded in reports.

### Changed

- `CFG-MANIFEST-001`, `CFG-MISSING-FILE-001`, `DEP-MISSING-001` and
  `DEP-CYCLE-001` are now `IMPLEMENTED` in the rule catalog.
- `--format html` now reports that HTML rendering is NOT IMPLEMENTED and names
  GATE 6, rather than being listed as an available format.

### Verified against official documentation

Behaviour was checked against Cfx.re documentation and the official
`cfx-server-data` repository rather than assumed. Three of those checks changed
the implementation:

- dependency entries beginning with `/` (`/server:5104`, `/onesync`,
  `/gameBuild:h4`) are runtime constraints, not resources, and are excluded from
  the graph;
- `ensure`/`start`/`stop`/`restart` accept a `[category]` name, which is never a
  missing resource;
- `provide 'name'` satisfies another resource's dependency on `name`.

### Known limitations

`exec`-ed configuration files are not followed; conditional logic in a manifest
is not evaluated; runtime constraints are listed but not checked; health,
performance, security and integrity analysis do not exist yet. See
`docs/GATE_STATUS.md`.

## [0.1.0] — GATE 0: Foundation

First build. Establishes the repository foundation. No analysis capability yet;
see `docs/GATE_STATUS.md`.

### Added

- **Repository**: npm workspace monorepo, TypeScript project references with
  strict compiler settings, type-aware ESLint, Vitest with unit, integration,
  security and performance projects, GitHub Actions CI.
- **`@sentinel-forge/shared`**: severity and confidence models, evidence and
  finding models with deterministic ordering, health scoring contracts, resource
  and dependency descriptors, the exit-code contract, and the rule catalog
  covering all 15 specified rule ids with rationale and known false positives.
- **Report schema 1.0**: versioned envelope, section types, base limitation
  text, structural validator.
- **`@sentinel-forge/core`**: configuration system with safe defaults and a
  single-pass validator; structured logging in pretty and JSON formats;
  credential redaction applied to logs, errors and evidence; the `SentinelError`
  hierarchy with error ids and exit codes; path containment with symlink escape
  detection; bounded file reads and directory traversal; streaming SHA-256
  hashing; deterministic identifiers; the SQLite layer with forward-only
  checksum-verified migrations; and the rule engine interfaces.
- **Database schema 1**: `servers`, `scan_runs`, `resources`, `resource_files`,
  `dependencies`, `findings`, `security_findings`, `baselines`,
  `performance_samples`, `integrity_snapshots`, `integrity_entries`,
  `incidents`, `incident_events`.
- **`@sentinel-forge/cli`**: `sentinel init`, `doctor`, `version` and `help`;
  the full command surface registered with honest delivery status; documented
  exit codes; `--json` for every command; results on stdout and logs on stderr.
- **Tests**: 212 tests across 28 files, including path traversal, symlink
  escape, redaction, resource exhaustion, repository hygiene and traversal
  benchmarks at 10, 100 and 500 resources.
- **Fixtures**: seven synthetic FiveM servers with declared expectations.
- **Documentation**: README, ARCHITECTURE, SECURITY, ROADMAP, LICENSE,
  THIRD_PARTY_LICENSES, and `docs/` covering CLI, API, development,
  compatibility, troubleshooting, release, licensing, MCP and gate status.

### Security

- No third-party runtime dependencies.
- No outbound network access, enforced by a source-level test.
- Scanned code is never executed, enforced by a source-level test.
- Secrets are redacted at every output boundary.
- Telemetry, network access and AI are off by default and rejected if enabled.

### Known limitations

No scanning, no runtime telemetry, no report generation, no health scoring, and
no rule executes. Windows and macOS are untested. `node:sqlite` is experimental
upstream. See `docs/GATE_STATUS.md § Known limitations of this build`.
