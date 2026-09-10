# Changelog

All notable changes to Sentinel Forge are recorded here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
the project uses [Semantic Versioning](https://semver.org/).

© 2026 Talal Al Ghafri. All Rights Reserved.

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
