# Gate status

© 2026 Talal Al Ghafri. All Rights Reserved.

The authoritative record of what exists in this build. Anything not listed as
delivered does not exist, however completely it may be described elsewhere in
the documentation.

**Current build: 0.6.0 — GATE 5 complete.**

| Gate | Scope | Status |
| --- | --- | --- |
| 0 | Foundation | ✅ Complete |
| 1 | Static scanner | ✅ Complete |
| 2 | Diagnostic engine | ✅ Complete |
| 3 | Performance intelligence | ✅ Complete |
| 4 | Security and integrity | ✅ Complete |
| 5 | Runtime resource | ✅ Complete |
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

## GATE 2 — Diagnostic engine ✅

### Delivered

| Area | What exists | Location |
| --- | --- | --- |
| Lua lexer | Full Lua 5.4 lexical grammar: names, keywords, decimal and hexadecimal numbers, all three string forms with escape decoding, both comment forms, operators. Token-budgeted, total, position-tracked. Shared with manifest parsing so the two cannot drift. | `packages/lua/src/lexer.ts` |
| Block structure | Loop and block ranges derived from block delimiters, including if/elseif/else chains and functions nested in loops. Reports unbalanced source instead of producing confident nonsense. | `packages/lua/src/structure.ts` |
| Call extraction | Qualified names (`Citizen.Wait`, `exports.oxmysql:execute`), literal string and number arguments including negative numbers, Lua call sugar, and an explicit flag when an argument is not a literal. | `packages/lua/src/calls.ts` |
| Script analysis | Loops with continuity, yield state and shortest literal wait; thread bodies; event registrations and triggers with direction and broadcast detection; database calls with statement classification. | `packages/analyzer/src/lua/script.ts` |
| Performance rules | `PERF-LOOP-001`, `PERF-EVENT-001`, `PERF-QUERY-001`. | `packages/analyzer/src/rules/performance.ts` |
| Event graph | Cross-resource registration and trigger relationships, broadcast and network flags, events triggered-but-unhandled and registered-but-unused, and a count of usages whose name is computed at runtime. | `packages/analyzer/src/events/graph.ts` |
| Health scoring | Traceable deductions weighted by confidence, per-category scores, normalized weighting across scored categories, documented caps, and unavailable categories reported with a reason. | `packages/analyzer/src/health/score.ts` |
| Pipeline | Script reading and analysis wired into the scan; health computed for the server and for every resource. | `packages/engine/src/scan.ts` |
| Commands | `health`, `resource <name>`. | `apps/cli/src/commands` |
| Report schema 1.1 | Optional `events` section and optional per-resource `health`. Additive. | `packages/shared/src/report/schema.ts` |

### Architecture changes

Two structural changes, both to remove a hazard rather than to add a feature:

- **`@sentinel-forge/lua`** now owns Lua lexing. Manifest parsing and script
  analysis previously would have carried separate copies of the same string and
  comment rules, which is exactly the kind of duplication that drifts.
- **`@sentinel-forge/engine`** now owns the scan pipeline, so the scanner does
  not have to depend on the analyzer. The dashboard (GATE 6) and the MCP server
  (GATE 7) will run the same pipeline rather than reimplementing it.

### Rules implemented in this build

| Rule | Severity | Notes |
| --- | --- | --- |
| `PERF-LOOP-001` | HIGH / MEDIUM | Only continuous loops (`while true`) with no visible yield. HIGH inside a created thread. Confidence 0.9 when the whole body is understood, 0.75 when it calls something unfollowable, 0.5 when the source did not balance. **`Wait(0)` yields and is never reported.** Bounded `for` loops and conditioned `while` loops are never reported. |
| `PERF-EVENT-001` | MEDIUM | A network trigger inside a loop that runs with no wait or below a 50 ms interval. Local `TriggerEvent` and bounded loops are not reported. |
| `PERF-QUERY-001` | HIGH / MEDIUM / LOW / INFO | Query per loop iteration (HIGH in a continuous loop, MEDIUM in a bounded one); SELECT with neither WHERE nor LIMIT (LOW, 0.6); `SELECT *` (INFO, 0.5). Parameterized, bounded queries are not reported. |

Eight rules remain `NOT_IMPLEMENTED` with their target gates.

### Validation

| Check | Result |
| --- | --- |
| `npm run check:versions` | ✅ Pass |
| `npm run check:migrations` | ✅ Pass |
| `npm run lint` | ✅ Pass — 0 errors, 0 warnings |
| `npm run typecheck` | ✅ Pass |
| `npm run build` | ✅ Pass |
| `npm test` | ✅ 470 tests, 52 files |

### Exit criteria

| Criterion | Met |
| --- | --- |
| Each rule detects its case in `performance-smell` | ✅ Asserted end to end |
| `PERF-LOOP-001` does not fire on the `Wait(0)` control | ✅ Asserted in the rule tests and again in the pipeline test |
| Health deductions sum to the score and each names a finding | ✅ Asserted for every category |
| The healthy fixture scores 100 | ✅ Asserted |
| No false positives on ordinary correct code | ✅ Asserted on a realistic snippet and on 500 generated resources |

### Known limitations of this build

1. **Block structure is not a parse tree.** The analysis knows which tokens are
   inside a loop body. It does not know types, scopes, or what a variable holds.
2. **A yield inside a called function is not followed.** A loop that yields
   through a helper is reported, at reduced confidence, with the unfollowed call
   count in the evidence.
3. **Only literal arguments are read.** An event name or SQL statement built at
   runtime is counted but not interpreted — a guessed value would be worse than
   none.
4. **Database detection is framework-specific.** `MySQL.*`, `oxmysql`,
   `ghmattimysql` and `mysql-async` shapes are recognised; a project wrapping its
   own database layer will not be.
5. **Only `.lua` files are analysed.** JavaScript resources are inventoried and
   hashed but not analysed.
6. **Reliability, security and integrity are not scored** — they have no analysis
   behind them yet, and are reported as unavailable.

### Readiness for GATE 3

| Requirement | Ready |
| --- | --- |
| Somewhere to store samples and baselines | ✅ `baselines`, `performance_samples` tables exist in schema 1 |
| Somewhere to store incidents | ✅ `incidents`, `incident_events` tables exist |
| A rule id for regressions | ✅ `PERF-REGRESSION-001` catalogued with rationale and false positives |
| A measurement evidence type | ✅ `MEASUREMENT` with value, unit, sample count and baseline value |
| Static performance findings to correlate against | ✅ Three rules producing them |
| A place to put the commands | ✅ `baseline`, `compare`, `incidents`, `purge` registered |

## GATE 3 — Performance intelligence ✅

### Delivered

| Area | What exists | Location |
| --- | --- | --- |
| Sample statistics | Mean, median, p95, min, max, standard deviation and coefficient of variation, with non-finite values discarded rather than propagated. | `packages/performance/src/statistics.ts` |
| Regression detection | Absolute and relative thresholds, minimum sample counts, a baseline-noise check, an optional player-count context check, and confidence built from sample count, separation and magnitude. | `packages/performance/src/regression.ts` |
| Baselines | Capture, list, show and delete, with resource content hashes, configuration fingerprint, the findings that stood and the health score. | `packages/performance/src/baseline.ts` |
| Sample storage | Recording and querying measured samples with provenance, ready for the runtime collector. | `packages/performance/src/baseline.ts` |
| Comparison | Resource added/removed/modified with details, configuration drift, findings introduced and resolved, health delta, and performance when samples exist on both sides. | `packages/performance/src/compare.ts` |
| Correlation | Pairs changes with the effects that follow them, with confidence built from shared resource, temporal proximity and ordering — capped so correlation can never read as proof. | `packages/incidents/src/correlation.ts` |
| Incidents | Timelines grouped by window, with severity, confidence, affected resources, the links that justified grouping, and a recommendation to verify rather than a stated cause. | `packages/incidents/src/incident.ts` |
| Retention and purge | Policy-driven expiry per record type, `ALL` scope for a full delete, dry run by default, and per-table storage reporting. | `packages/core/src/db/retention.ts` |
| Commands | `baseline`, `compare`, `incidents`, `purge`. | `apps/cli/src/commands` |
| Database schema 2 | `baseline_resources`, `baseline_findings`, and health/finding counts on `baselines`. | `database/migrations/0002_baselines_and_incidents.sql` |

### The honest constraint in this gate

**No runtime collector exists before GATE 5, so nothing measures resource
timing yet.** That shaped the design rather than being worked around:

- A baseline records the data that genuinely exists today — resource content
  hashes, configuration fingerprint, findings, health score — and reports a
  sample count of **zero**. It does not estimate timing from static analysis.
- `compare` states plainly that performance was not compared, and why. A section
  quietly omitted would read as "no regressions found", which is a different
  claim from "nothing was measured".
- The regression engine is complete and fully tested against supplied samples.
  When the collector lands, it has a source; until then it has none, and says so.

### Guarding against false positives

`PERF-REGRESSION-001`'s documented false positives are each handled explicitly
and each has a test:

| Case | Handling |
| --- | --- |
| Large percentage on a tiny absolute value | Absolute threshold (default 0.2 ms). 0.01 → 0.04 ms is +300% and is not reported. |
| Too few samples | Minimum 8 per side; below that the verdict is `INSUFFICIENT_SAMPLES`, not "no regression". |
| Noisy baseline | A baseline varying by more than 75% of its own mean is `BASELINE_TOO_NOISY`. |
| Different load | An optional player-count delta check yields `CONTEXT_MISMATCH`. |
| Improvement | Reported as `IMPROVEMENT`, not as a regression. |

Confidence from recorded samples is capped at 0.9, and correlation confidence at
0.85: neither establishes a cause.

### Validation

| Check | Result |
| --- | --- |
| `npm run check:versions` | ✅ Pass |
| `npm run check:migrations` | ✅ Pass |
| `npm run lint` | ✅ Pass — 0 errors, 0 warnings |
| `npm run typecheck` | ✅ Pass |
| `npm run build` | ✅ Pass |
| `npm test` | ✅ 552 tests, 60 files |

### Exit criteria

| Criterion | Met |
| --- | --- |
| A regression is detected between two baselines | ✅ Asserted with supplied samples |
| A large relative change on a tiny absolute value is not reported | ✅ Asserted |
| An incident correlates a change with an effect and states a confidence | ✅ Asserted end to end on a real server tree |
| Causation is never claimed | ✅ Asserted against the wording of both the incident summary and the regression finding |
| The server is never modified | ✅ Asserted across the whole lifecycle, including purge |

### Known limitations of this build

1. **No measured timing.** Baselines record zero samples until GATE 5.
2. **Incident timestamps are baseline capture times**, not runtime instants, so
   an incident describes a window rather than a moment.
3. **Correlation is pairwise.** It relates one change to one effect; it does not
   build multi-step causal chains, and deliberately does not try to.
4. **Purge is per server or global.** There is no per-baseline or per-rule
   selective expiry.

### Readiness for GATE 4

| Requirement | Ready |
| --- | --- |
| Redaction at every output boundary | ✅ Delivered in GATE 0, tested against the security fixture |
| File hashes and inventories per resource | ✅ Recorded on every scan and in every baseline |
| Integrity tables | ✅ `integrity_snapshots`, `integrity_entries` in schema 1 |
| Security finding storage with a redacted-excerpt contract | ✅ `security_findings` in schema 1 |
| Rule ids for what GATE 4 detects | ✅ Seven catalogued with rationale and false positives |
| A fixture with planted indicators | ✅ `security-indicators`, with fictional placeholders |
| Lua analysis to build detection on | ✅ Calls, strings and structure from GATE 2 |

## GATE 4 — Security and integrity ✅

### Delivered

| Area | What exists | Location |
| --- | --- | --- |
| Secret detection | Ten credential formats — Discord webhooks and bot tokens, generic webhooks, PEM private keys, JWTs, URI credentials, authorization headers, API keys, passwords, licence keys — with placeholder and entropy adjustments, and overlap resolved by pattern specificity. | `packages/security/src/secrets.ts` |
| Obfuscation indicators | Encoded-literal density, decode chains feeding a loader, character reconstruction, escaped-literal density, long generated lines, opaque identifiers — weighted so one weak signal never reports on its own. | `packages/security/src/obfuscation.ts` |
| Execution indicators | Remote fetch paired with a code loader (grouped per fetch), dynamic execution of non-literal input, and writes to executable paths. | `packages/security/src/execution.ts` |
| Suspicious files | Executables, host scripts, archives, native modules and database files, each with a confidence that reflects how often it is legitimate. | `packages/security/src/files.ts` |
| Integrity snapshots | Every file with size, content hash, modification time and type, plus a snapshot hash for cheap equality. | `packages/integrity/src/snapshot.ts` |
| Integrity comparison | Added, modified and deleted files, with **touched** (identical content, new timestamp) reported separately so it cannot be mistaken for a change. | `packages/integrity/src/compare.ts` |
| Commands | `security`, `integrity <snapshot\|list\|compare\|delete>`. | `apps/cli/src/commands` |

### The constraint this gate was built around

**Sentinel Forge finds credentials without ever reproducing one.** A detector
returns a location, a type, a redacted excerpt and a masked value; the raw value
is used to judge confidence and then dropped.

`tests/security/secret-disclosure.test.ts` enforces this end to end. It extracts
every credential-shaped value planted in the fixture and asserts that none
appears in the security command's stdout, its `--json` output, its verbose log,
a JSON report, a Markdown report, **any table of the local database**, a
baseline, or an integrity snapshot — while still asserting that each finding
reports the file and line, so it stays actionable.

A companion test guards against the assertion going vacuous: it checks that the
fixture really does contain credentials and that the detector really does find
them, including at least one at confidence ≥ 0.8.

### Wording as a tested property

Security findings are indicators. Three properties are asserted, not merely
intended:

- the standing limitation prints with every `sentinel security` run, and is
  carried in the report's security section and its limitations list;
- output never contains *malicious*, *backdoor*, *malware detected* or
  *compromised*;
- obfuscation is described as blocking review and explicitly "not in itself
  evidence of wrongdoing", because commercial resources are routinely obfuscated
  for licence protection.

### Fixture design, and a lesson from it

Testing a credential detector needs both paths: values that are obviously
placeholders, and values shaped like live credentials.

- **`security-indicators/sf_suspicious`** is committed and uses values
  explicitly marked as examples. The detector correctly downgrades them to
  0.25–0.45 confidence — that downgrade is itself under test, since a real
  server's example configuration is the most common source of false positives.
- **Realistically shaped values are generated at test time**, by
  `tests/helpers/fabricated-credentials.ts`, and never committed.

The second point was learned the hard way. Realistic values were first committed
as a fixture resource, and **GitHub push protection rejected the push**: one
fabricated string matched a vendor's published API-key format. The scanner was
right to block it. A repository that contains strings a secret scanner reads as
live trips protection, alarms reviewers, and contradicts this product's own
commitment that no secret is committed — so the values are now assembled from
fragments at runtime. The detector sees identical input; the repository contains
nothing that reads as a credential.

### Validation

| Check | Result |
| --- | --- |
| `npm run check:versions` | ✅ Pass |
| `npm run check:migrations` | ✅ Pass |
| `npm run lint` | ✅ Pass — 0 errors, 0 warnings |
| `npm run typecheck` | ✅ Pass |
| `npm run build` | ✅ Pass |
| `npm test` | ✅ 636 tests, 68 files |

### Exit criteria

| Criterion | Met |
| --- | --- |
| Every indicator in the fixture is detected | ✅ Five rules asserted end to end |
| No raw secret appears anywhere in output | ✅ Asserted across six output paths including the database |
| Obfuscation is reported as requiring review, not as malice | ✅ Asserted against the wording |
| Integrity comparison reports added, modified and deleted | ✅ Asserted against the fixture's declared change |
| The healthy fixture reports no security indicators | ✅ Asserted |
| Files are never acted on | ✅ Asserted that the tracked tree is byte-identical after a full lifecycle |

### Defects found and fixed in this gate

- **The rule catalog was wrong.** Three GATE 2 rules and one GATE 3 rule were
  running while still catalogued as `NOT_IMPLEMENTED`, so `sentinel help rules`
  under-reported the product. A test now derives the emitted rule ids from
  source and asserts the catalog matches in both directions.
- **Overlap resolution preferred the wrong match.** Deduplication ranked by
  confidence, which kept a generic classification over a specific one precisely
  when the specific pattern had found evidence that the value was a placeholder.
  It now ranks by specificity first.
- **A zero-entropy value scored too high.** A 22-character all-zeros token is
  definitionally not live; low character variety now carries a real penalty.
- **The repository's own credential check was imprecise.** Under a
  case-insensitive flag its mixed-case test matched any two letters, so a label
  map entry (`PASSWORD: 'password'`) read as a committed secret. The check now
  requires a digit, a symbol or substantial length, and has its own test
  asserting it flags realistic credentials and not labels.

### Known limitations of this build

1. **Detection is by known format.** A credential in an unknown format is not
   detected; entropy is a secondary signal only, because entropy-first detection
   flags hashes and asset identifiers.
2. **Obfuscation detection is density-based.** A lightly transformed file may
   score below the reporting threshold.
3. **Remote-load pairing is proximity-based.** A fetch whose result reaches a
   loader more than 60 lines away, or through a variable across functions, is
   not paired.
4. **Binary content is classified, never parsed.** A native module is reported
   by type and hash; its contents are not analysed.
5. **Integrity has no scheduled capture.** Snapshots are taken when asked for.

### Readiness for GATE 5

| Requirement | Ready |
| --- | --- |
| Sample storage with provenance | ✅ `performance_samples` with a `source` column |
| A regression engine awaiting a source | ✅ Complete and tested against supplied samples |
| Bounded, contained filesystem access | ✅ Delivered in GATE 0 |
| A place for the collector to live | ✅ `resources/sentinel_doctor` with its constraints documented |
| A rule requiring runtime data | ✅ `PERF-REGRESSION-001` |
| Health category awaiting runtime data | ✅ `RELIABILITY`, reported as unavailable with the reason |

## GATE 5 — Runtime resource ✅

The product measures a running server for the first time.

### The finding that shaped this gate

Before writing a line of the collector, every FiveM API it might use was checked
against the official native declarations in
[`citizenfx/fivem`](https://github.com/citizenfx/fivem/tree/master/ext/native-decls)
and [docs.fivem.net](https://docs.fivem.net/). One check changed the design of
the whole gate:

> **FiveM exposes no scripting API for per-resource CPU or tick time on the
> server.** The official profiler (`profiler record`, `profiler saveJSON`) is a
> console command that writes a file. It cannot be driven from a script, and
> nothing else exposes another resource's timing.

The specification asks for resource timing. It cannot be had. The options were
to estimate it, to omit the gate, or to measure the closest thing that is real
and say plainly what is missing. Sentinel Forge does the third: a fabricated
per-resource figure would corrupt every baseline and every regression comparison
built on it, and nothing downstream could detect that it had.

So **no per-resource timing exists anywhere in this build** — not in the
collector, not in the database, not in a report, not in the dashboard that comes
next — and the limitation is printed next to every piece of runtime output
rather than filed in a manual.

### Delivered

| Area | What exists | Location |
| --- | --- | --- |
| Collector resource | Server-side FiveM resource measuring scheduler latency, resource state, state transitions and a player count. Three threads, bounded buffers, telemetry written with `SaveResourceFile` into its own directory in a bounded rotation. | `resources/sentinel_doctor/` |
| Collector configuration | Seven server convars, all documented, all with quiet defaults. Nothing in the resource needs editing. | `resources/sentinel_doctor/server/config.lua` |
| Telemetry location | Finds the collector under a resource directory or one category directory deep — the two documented FiveM layouts — without walking the server. | `packages/runtime/src/locate.ts` |
| Telemetry parsing | Schema version checked, not assumed; non-finite samples discarded; absent fields left absent. | `packages/runtime/src/telemetry.ts` |
| Idempotent ingestion | Each document identified by a digest over its measurements, recorded on import, skipped when seen again. Safe to run on a timer. | `packages/runtime/src/ingest.ts` |
| Command | `sentinel runtime status` / `import` / `events`. | `apps/cli/src/commands/runtime.ts` |
| Storage | Migration 3: `runtime_ingest_files` (what has been read) and `runtime_events` (what the server was observed to do), kept apart from the inferred `incidents` tables. | `database/migrations/0003_runtime_telemetry.sql` |
| Samples → regression | Capturing a baseline claims the samples collected since the previous one, so `sentinel compare` compares two measurement windows. | `packages/performance/src/baseline.ts` |
| Report | Optional `performance.runtime` section (schema 1.2) describing what was measured, separate from static analysis. | `packages/engine/src/scan.ts` |

### Natives and events used, and what each was verified to provide

| API | Used for | Verified against |
| --- | --- | --- |
| `GetGameTimer` | Monotonic milliseconds, for latency and uptime | Official shared native declaration |
| `GetNumResources`, `GetResourceByFindIndex`, `GetResourceState` | Resource state sweep | Official shared native declarations |
| `onResourceStart`, `onResourceStop` | State transitions, event-driven | Official server event documentation |
| `GetNumPlayerIndices` | Player **count** only | Official server native declaration |
| `GetConvar`, `GetConvarInt` | Configuration | Official server native declarations |
| `SaveResourceFile`, `GetCurrentResourceName`, `GetResourceMetadata` | Writing telemetry inside its own resource | Official server native declarations |
| `RegisterCommand`, `CreateThread`, `Wait`, `AddEventHandler` | Structure | Official runtime documentation |

No undocumented API is called. No API is called speculatively behind a `pcall`
to see whether it exists.

### Overhead

| Cost | How it is measured | Figure at the shipped defaults |
| --- | --- | --- |
| Disk, worst case (every buffer full at every flush) | `tests/performance/collector.test.ts` | 12.3 MiB across the 12-file rotation |
| Disk, steady state | `tests/performance/collector.test.ts` | ~11 KiB per file, 120 samples per flush |
| Importing a full worst-case rotation | `tests/performance/collector.test.ts` | ~0.5 s for 60,000 samples and 2,400 events |
| Re-reading an already-imported rotation | `tests/performance/collector.test.ts` | ~0.1 s, nothing written |
| **In-server CPU and tick cost** | **Not measured automatically** — it requires a running FiveM server, which no test here has. Manual procedure documented and run before each release. | See `resources/sentinel_doctor/README.md` |

That last row is stated rather than filled with a plausible number. It is also
asserted as a line of benchmark output, so a release manager reading the
figures sees the gap next to them.

### The collector is analysed by the product that ships it

`tests/integration/collector-resource.test.ts` reads the collector's Lua with
Sentinel Forge's own lexer and asserts, against the source rather than against
the README: no network native, no `load`/`loadstring`/`dofile`, no command
execution, no resource-state mutation, no player identity native beyond the
count, writes only through `SaveResourceFile` into `GetCurrentResourceName()`,
both buffers bounded, no metric name claiming to be CPU or tick time, no
credential, and every convar it reads documented.

A promise in a README is not a control.

### Validation

Run with Node.js 22.22.2 on Linux x64:

| Check | Result |
| --- | --- |
| `npm run check:versions` | ✅ Pass — 0.6.0 across 14 packages |
| `npm run check:migrations` | ✅ Pass — 3 migrations current |
| `npm run lint` | ✅ Pass — 0 errors, 0 warnings |
| `npm run typecheck` | ✅ Pass |
| `npm run test:unit` | ✅ 538 tests |
| `npm run test:integration` | ✅ 101 tests |
| `npm run test:security` | ✅ 50 tests |
| `npm run test:performance` | ✅ 16 tests |
| Total | ✅ 705 tests, 73 files |

### Known limitations of this build

1. **No per-resource CPU or tick time.** FiveM exposes no scripting API for it.
   This is permanent until Cfx.re provides one; it is not a missing feature.
2. **Scheduler latency is measured from inside the collector's own thread.** It
   says how promptly the server serviced that thread. It is a real property of
   the server and a real proxy for hitching, but it does not identify which
   resource made the server late.
3. **The collector's in-server CPU cost is not measured by any automated test.**
   Disk and ingestion costs are.
4. **Telemetry arrives in batches.** The default flush interval is 60 seconds,
   so the newest measurements are up to one interval old. There is no live feed.
5. **Reliability is not scored.** FiveM exposes no scripting API through which
   one resource can observe another's runtime errors. State transitions are
   recorded and shown; they are not turned into a reliability score, because
   that would be inference presented as measurement.
6. **Regression detection needs samples on both sides.** A comparison between a
   baseline with samples and one without reports that it was not compared,
   rather than reporting no regression.
7. **A resource stopping is recorded as a resource stopping.** Why it stopped is
   not observable from a script, and is not inferred.

### Readiness for GATE 6

| Requirement | Ready |
| --- | --- |
| Measured data to display | ✅ `performance_samples`, `runtime_events` |
| A report section describing it | ✅ `performance.runtime`, schema 1.2 |
| A limitation to render beside it | ✅ `RUNTIME_SECTION_LIMITATION` |
| Local-only storage, no network | ✅ Nothing in the product makes a network request |

## GATE 6 — Dashboard ⬜

**Next gate.** Local-first, bound to `127.0.0.1`, read-only. It renders what the
earlier gates produced and adds no analysis of its own; anything it shows that
was not measured must say so, exactly as the CLI does.

## GATE 7 — MCP interface ⬜

Not started. Read-only. See [MCP.md](MCP.md).

## GATE 8 — Commercial hardening ⬜

Not started, and not to be started before the MVP is validated in real use.

---

## How this file is maintained

Updated as the final step of every gate, before the gate is declared complete.
If this file and the code disagree, the code is right and this file is a defect.
