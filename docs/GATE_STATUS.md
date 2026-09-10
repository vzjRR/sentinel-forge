# Gate status

© 2026 Talal Al Ghafri. All Rights Reserved.

The authoritative record of what exists in this build. Anything not listed as
delivered does not exist, however completely it may be described elsewhere in
the documentation.

**Current build: 0.2.0 — GATE 1 complete.**

| Gate | Scope | Status |
| --- | --- | --- |
| 0 | Foundation | ✅ Complete |
| 1 | Static scanner | ✅ Complete |
| 2 | Diagnostic engine | ⬜ Not started |
| 3 | Performance intelligence | ⬜ Not started |
| 4 | Security and integrity | ⬜ Not started |
| 5 | Runtime resource | ⬜ Not started |
| 6 | Dashboard | ⬜ Not started |
| 7 | MCP interface | ⬜ Not started |
| 8 | Commercial hardening | ⬜ Not started |

---

## GATE 0 — Foundation ✅

### Delivered

| Area | What exists | Location |
| --- | --- | --- |
| Repository | npm workspace monorepo, TypeScript project references, strict compiler settings, ESLint with type-aware rules, Vitest with four test projects, CI workflow. | root |
| Shared contracts | Severity model, confidence model and bands, evidence model, finding model with deterministic ordering, health scoring contracts, resource and dependency descriptors, exit-code contract, product constants. | `packages/shared` |
| Rule catalog | All 15 specified rule ids with category, default severity, rationale, known false positives, evidence requirements, delivery status and owning package. | `packages/shared/src/rules/catalog.ts` |
| Report schema | Versioned envelope (`schemaVersion` 1.0), section types, base limitation text, structural validator. | `packages/shared/src/report` |
| Configuration | Typed schema with safe defaults, single-pass validator with actionable messages, upward file discovery, precedence chain, path resolution. | `packages/core/src/config` |
| Logging | Structured logger, pretty and JSON formats, level filtering, child contexts, redaction on every record, stderr-only output. | `packages/core/src/logging/logger.ts` |
| Redaction | Credential-format redaction for webhooks, PEM keys, URI credentials, authorization headers, JWTs, bot tokens and credential-named assignments; deep structure redaction with cycle handling; secret masking. | `packages/core/src/logging/redaction.ts` |
| Error model | `SentinelError` hierarchy with category, exit code, error id, remediation and safe JSON serialization; normalization of unknown thrown values. | `packages/core/src/errors.ts` |
| Filesystem security | Path containment with real-path resolution and symlink escape detection, bounded reads restricted to regular files, bounded traversal with cycle detection and reported skip reasons. | `packages/core/src/fs` |
| Hashing and ids | Streaming SHA-256 file hashing, order-independent fingerprints, deterministic finding/resource/server ids, random run and incident ids. | `packages/core/src/fs/hash.ts`, `ids.ts` |
| Storage | `DatabaseDriver` interface, `node:sqlite` implementation with WAL, foreign keys and savepoint-based nested transactions; forward-only migrations with checksum verification; all 12 specified tables. | `packages/core/src/db`, `database/migrations` |
| Rule engine | `RuleDefinition` interface requiring documented false positives, registry with catalog cross-checking, finding builder enforcing invariants and redaction. | `packages/core/src/rules` |
| CLI | Hand-written argument parser, full command surface with honest status, `init`, `doctor`, `version` and `help` implemented, documented exit codes, stdout/stderr split, `--json` for every command. | `apps/cli` |
| Test infrastructure | Unit, integration, security and performance projects. | `packages/*/src/**/*.test.ts`, `tests/` |
| Fixtures | 7 synthetic servers (54 files) with declared expectations: healthy, missing-dependency, broken-manifest, performance-smell, security-indicators, integrity-change, mixed. | `tests/fixtures` |
| Documentation | README, ARCHITECTURE, SECURITY, ROADMAP, LICENSE, THIRD_PARTY_LICENSES, CHANGELOG, and `docs/` (CLI, API, DEVELOPMENT, COMPATIBILITY, TROUBLESHOOTING, RELEASE, LICENSING, MCP, GATE_STATUS). | root, `docs/` |

### Commands in this build

| Command | Status |
| --- | --- |
| `sentinel init` | ✅ Creates configuration, data directory and migrated database. Idempotent. |
| `sentinel doctor` | ✅ Seven environment checks with per-check remediation. |
| `sentinel version` | ✅ Product, report schema and database schema versions. |
| `sentinel help [command\|rules]` | ✅ Command surface, options, exit codes, rule catalog. |
| `scan`, `dependencies`, `report` | ✅ Delivered in GATE 1 |
| `health`, `resource` | ❌ NOT IMPLEMENTED — GATE 2 |
| `baseline`, `compare`, `incidents`, `purge` | ❌ NOT IMPLEMENTED — GATE 3 |
| `security`, `integrity` | ❌ NOT IMPLEMENTED — GATE 4 |

Every `NOT IMPLEMENTED` command is registered, appears in help, and exits with
code `2` naming the gate that delivers it.

### Rules in this build (as of GATE 0)

No rule executed in the GATE 0 build. All were catalogued with status
`NOT_IMPLEMENTED` and a target gate:

| Rules | Gate |
| --- | --- |
| `CFG-MANIFEST-001`, `CFG-MISSING-FILE-001`, `DEP-MISSING-001`, `DEP-CYCLE-001` | 1 |
| `PERF-LOOP-001`, `PERF-EVENT-001`, `PERF-QUERY-001` | 2 |
| `PERF-REGRESSION-001` | 3 |
| `SEC-SECRET-001`, `SEC-WEBHOOK-001`, `SEC-OBFUSCATION-001`, `SEC-REMOTE-LOAD-001`, `SEC-DYNAMIC-EXEC-001`, `SEC-SUSPICIOUS-FILE-001`, `INT-CHANGE-001` | 4 |

The catalog is a specification of intended behaviour. It does not claim
implementation. `sentinel help rules` shows the same status.

### Packages in this build

| Package | Status |
| --- | --- |
| `@sentinel-forge/shared` | ✅ Implemented |
| `@sentinel-forge/core` | ✅ Implemented |
| `@sentinel-forge/cli` | ✅ Implemented |
| `@sentinel-forge/scanner` | ✅ Implemented (GATE 1) |
| `@sentinel-forge/dependencies` | ✅ Implemented (GATE 1) |
| `@sentinel-forge/reports` | ✅ Implemented (GATE 1) |
| `analyzer` | 📁 Directory with a status README — GATE 2 |
| `performance` | 📁 Directory with a status README — GATE 3 |
| `security`, `integrity` | 📁 Directory with a status README — GATE 4 |
| `runtime`, `resources/sentinel_doctor` | 📁 Directory with a status README — GATE 5 |
| `apps/dashboard` | 📁 Directory with a status README — GATE 6 |
| `apps/mcp` | 📁 Directory with a status README — GATE 7 |

Placeholder directories are **not** registered as workspaces and produce no
build output. An empty compiled package would be a claim that something exists.

### Validation

Run with Node.js 22.22.2 on Linux x64:

| Check | Result |
| --- | --- |
| `npm run check:migrations` | ✅ Pass — embedded migrations current |
| `npm run lint` | ✅ Pass — 0 errors, 0 warnings |
| `npm run typecheck` | ✅ Pass — packages and test suites |
| `npm run build` | ✅ Pass |
| `npm run test:unit` | ✅ Pass |
| `npm run test:integration` | ✅ Pass |
| `npm run test:security` | ✅ Pass |
| `npm run test:performance` | ✅ Pass |
| Total | ✅ 212 tests, 28 files |

Traversal benchmark (Linux x64, Node 22.22.2): 10 resources ≈ 9 ms,
100 resources ≈ 50 ms, 500 resources ≈ 190 ms — linear.

### Known limitations of this build

1. **No analysis capability.** Nothing is scanned, parsed or scored yet. This
   build is the foundation the analysis is built on.
2. **No runtime telemetry.** No FiveM API is used anywhere; nothing is collected
   from a running server.
3. **Windows and macOS are untested.** Path handling is written for them but not
   verified on them. See [COMPATIBILITY.md](COMPATIBILITY.md).
4. **`node:sqlite` is experimental upstream.** Isolated behind `DatabaseDriver`.
5. **Retention configuration is not yet enforced.** The values are validated and
   stored; the expiry job arrives with `purge` in GATE 3.
6. **Report generation is not implemented.** The schema and its validator exist;
   the writer arrives in GATE 1.
7. **Health scoring is not implemented.** The contract exists; the engine
   arrives in GATE 2.

### Readiness for GATE 1

| Requirement | Ready |
| --- | --- |
| Contained filesystem access for untrusted paths | ✅ Path containment, bounded reads, bounded traversal, tested |
| Somewhere to record discoveries | ✅ `servers`, `resources`, `resource_files`, `dependencies`, `scan_runs` tables with cascade |
| A way to express what was found | ✅ Finding model, evidence model, validated builder |
| Rule ids for what GATE 1 detects | ✅ Four catalogued with rationale and false positives |
| A report shape to emit | ✅ Versioned envelope and structural validator |
| Test material | ✅ Fixtures for missing dependencies, broken manifests, cycles and a healthy control |
| A place to put the command | ✅ `scan`, `dependencies` and `report` registered, awaiting implementation |
| Configuration for scan behaviour | ✅ `server.resourceDirectories`, `scan.*`, `analysis.*` validated |

---

## GATE 1 — Static scanner ✅

### Delivered

| Area | What exists | Location |
| --- | --- | --- |
| Manifest lexer | Full Lua lexical subset used by manifests: names, all three string forms, long brackets, comments, numbers, punctuation. Never executes the file. Reports unterminated strings and comments with positions, and keeps earlier declarations usable. | `packages/scanner/src/manifest/lexer.ts` |
| Manifest parser | Recognises `directive 'value'`, `directive { … }`, call syntax and `data_file 'TYPE' 'path'`. Skips unrecognised statements rather than failing the file. Records unknown directives at INFO. | `packages/scanner/src/manifest/parser.ts` |
| Manifest model | Typed view: fx_version, games, metadata, scripts by kind, files, ui_page, dependencies, provides, data files — each with its source position. Splits `@resource/path` references. | `packages/scanner/src/manifest/manifest.ts` |
| Glob resolution | `*`, `?`, `**` and `**/` with prefix matching, resolved against the resource's own file inventory rather than by re-reading the filesystem. | `packages/scanner/src/glob.ts` |
| Configuration parser | `ensure`/`start`/`stop`/`restart`, `set`/`sets`/`setr`, `exec`, quoted arguments, `#` and `//` comments, CRLF. Resolves which resources the configuration starts. | `packages/scanner/src/config/server-config.ts` |
| Discovery | Single traversal of the server; resource grouping including `[category]` directories; per-file size, SHA-256 and mtime; configuration location; server fingerprint; every skipped path reported. | `packages/scanner/src/discovery/discover.ts` |
| Platform resources | Names verified in the official cfx-server-data repository, used to keep platform-provided dependencies out of the HIGH-severity band. | `packages/scanner/src/discovery/platform-resources.ts` |
| Dependency graph | Declared and discovered edges, `provide` resolution, iterative cycle detection with canonical rotation, runtime constraints separated out. | `packages/dependencies/src/graph.ts` |
| Rules | Five implemented rules with evidence, severity and confidence. | `packages/scanner/src/rules`, `packages/dependencies/src/rules.ts` |
| Scan pipeline | Discovery → rules → graph → report, with severity filtering, disabled-rule handling and deterministic ordering. | `packages/scanner/src/scan.ts` |
| Storage | Transactional persistence of servers, scan runs, resources, resource files, dependencies and findings; upserts keyed on natural identity so re-scanning updates rather than duplicates. | `packages/core/src/db/repository.ts` |
| Reports | JSON (schema-validated, canonical key order) and Markdown (grouped by severity, evidence locations, always with limitations). | `packages/reports` |
| Commands | `scan`, `dependencies`, `report`. | `apps/cli/src/commands` |

### Rules implemented in this build

| Rule | Severity | Notes |
| --- | --- | --- |
| `CFG-MANIFEST-001` | HIGH / MEDIUM / LOW / INFO | Missing manifest, unparsable manifest, missing or unrecognised `fx_version`/`game`, legacy `__resource.lua` (INFO). An unrecognised `fx_version` is reported at 0.5 confidence, because Cfx.re may publish a version newer than this build knows. |
| `CFG-MISSING-FILE-001` | HIGH / MEDIUM | A literal path that does not exist is HIGH at 0.95; a glob matching nothing is MEDIUM at 0.6, because an optional file set is a legitimate reason. `@resource` references are excluded. |
| `CFG-ENSURE-MISSING-001` | HIGH / INFO | New in this gate. `[category]` targets and `stop` directives are never reported; platform-provided resources drop to INFO at 0.2. |
| `DEP-MISSING-001` | HIGH / INFO | Declared dependencies at 0.95, `@resource` references at 0.85. Runtime constraints (`/server:…`, `/onesync`) are excluded. `provide` satisfies a dependency. |
| `DEP-CYCLE-001` | MEDIUM | One evidence record per edge. Worded as non-deterministic load order, not as guaranteed failure. |

Eleven rules remain `NOT_IMPLEMENTED` with their target gates.

### Validation

Run with Node.js 22.22.2 on Linux x64:

| Check | Result |
| --- | --- |
| `npm run check:versions` | ✅ Pass |
| `npm run check:migrations` | ✅ Pass |
| `npm run lint` | ✅ Pass — 0 errors, 0 warnings |
| `npm run typecheck` | ✅ Pass — packages and test suites |
| `npm run build` | ✅ Pass |
| `npm test` | ✅ 368 tests, 44 files |

Scan benchmark (Linux x64, Node 22.22.2): 10 resources ≈ 69 ms, 100 ≈ 399 ms,
500 ≈ 1835 ms — linear, and with zero findings on generated well-formed servers.

### Exit criteria

| Criterion | Met |
| --- | --- |
| Each rule detects its fixture case | ✅ Asserted per fixture in `tests/integration/scan-pipeline.test.ts` |
| Nothing is reported on `healthy-server` | ✅ Asserted, and again on 500 generated resources in the benchmark |
| A JSON report validates against the schema | ✅ Asserted end to end |
| An integration test covers server → scan → database → findings → report | ✅ `tests/integration/scan-pipeline.test.ts` |
| Re-scanning is idempotent and ids are deterministic | ✅ Asserted |

### Known limitations of this build

1. **`exec`-ed configuration files are not followed.** A resource started only by
   a nested configuration file will be reported as not started.
2. **Conditional logic in a manifest is not evaluated.** A path computed at load
   time yields no literal to check, and the declaration is skipped rather than
   guessed at.
3. **Runtime constraints are listed, not checked.** `/server:5104` is recorded;
   whether the server satisfies it is unknown without runtime data.
4. **Health scoring, performance, security and integrity analysis do not exist
   yet.** Those report sections are absent rather than empty.
5. **HTML reports are not implemented.** `--format html` reports that fact and
   names GATE 6.
6. **No runtime data.** No FiveM API is called anywhere in the product.
7. **Windows and macOS remain untested.**

### Readiness for GATE 2

| Requirement | Ready |
| --- | --- |
| A file inventory to analyse | ✅ Every resource file with path, size, hash and type |
| Bounded reading of source files | ✅ `readTextFileBounded`, size-capped and contained |
| Somewhere to attach findings | ✅ Finding and evidence models, validated builder, storage |
| Rule ids for what GATE 2 detects | ✅ Three catalogued with rationale and false positives |
| Fixtures with the patterns to detect | ✅ `performance-smell`, including the `Wait(0)` false-positive control |
| Health scoring contract | ✅ Defined in `@sentinel-forge/shared`, unimplemented by design |
| A place to put the commands | ✅ `health` and `resource` registered, awaiting implementation |

## GATE 2 — Diagnostic engine ⬜

**Next gate.** Lua static analysis, event graph analysis, database query
analysis, and health scoring where every deduction traces to a finding.

Rules `PERF-LOOP-001`, `PERF-EVENT-001`, `PERF-QUERY-001`.
Commands `health`, `resource`.

Exit criteria: each rule detects its case in `performance-smell`;
`PERF-LOOP-001` does **not** fire on the `Wait(0)` control in that fixture; a
health score is produced whose deductions sum to the score and each name a
finding.

## GATE 3 — Performance intelligence ⬜

Not started. Baselines, sample storage, comparison, regression detection with
absolute and relative thresholds, correlation and incident engines, retention
and purge. Rule `PERF-REGRESSION-001`. Commands `baseline`, `compare`,
`incidents`, `purge`.

## GATE 4 — Security and integrity ⬜

Not started. Secret scanning, obfuscation indicators, remote-load detection,
suspicious file detection, integrity snapshots and comparison. Seven rules.
Commands `security`, `integrity`.

## GATE 5 — Runtime resource ⬜

Not started. `resources/sentinel_doctor` with verified FiveM APIs only, and
mandatory overhead benchmarks. Significant overhead is a release blocker.

## GATE 6 — Dashboard ⬜

Not started. Local-first, bound to `127.0.0.1`.

## GATE 7 — MCP interface ⬜

Not started. Read-only. See [MCP.md](MCP.md).

## GATE 8 — Commercial hardening ⬜

Not started, and not to be started before the MVP is validated in real use.

---

## How this file is maintained

Updated as the final step of every gate, before the gate is declared complete.
If this file and the code disagree, the code is right and this file is a defect.
