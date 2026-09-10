# Architecture

© 2026 Talal Al Ghafri. All Rights Reserved.

This document describes how Sentinel Forge is put together and, more usefully,
why it is put together that way. It is kept in step with the implementation;
where something is not built yet, it is marked with the gate that delivers it.

## 1. The pipeline

Sentinel Forge is a pipeline, not a dashboard with a database behind it. Each
stage produces something the next stage can use, and every stage is inspectable.

```
  MEASURE            read the server, collect runtime evidence
     |
  COLLECT EVIDENCE   file references, code patterns, hashes, samples
     |
  ANALYZE            rules turn evidence into findings
     |
  CORRELATE          relate findings, changes and events over time
     |
  EXPLAIN            health scores, incident timelines, reports
     |
  RECOMMEND          the next thing a human should look at
```

The pipeline is deterministic. The same input produces the same findings, the
same ids and the same ordering — a property the report format, the finding ids
and the sort comparators are all designed around, because a diagnostic tool
whose output changes between runs cannot be diffed, and a tool whose output
cannot be diffed cannot answer "what changed?".

## 2. Package structure

The repository is an npm workspace monorepo. Packages are split along the axis
of *what changes together*, not by technical layer.

| Package | Responsibility | Gate |
| --- | --- | --- |
| `@sentinel-forge/shared` | Types and pure functions: severity, confidence, evidence, findings, health, rule catalog, report schema. No I/O. | 0 ✅ |
| `@sentinel-forge/core` | Foundation runtime: configuration, logging, redaction, errors, contained filesystem access, hashing, SQLite, storage, rule engine interfaces. | 0 ✅ |
| `@sentinel-forge/cli` | The `sentinel` command surface. | 0 ✅ |
| `@sentinel-forge/scanner` | Server discovery, resource discovery, manifest parsing, configuration analysis, the scan pipeline. | 1 ✅ |
| `@sentinel-forge/dependencies` | Dependency graph construction and analysis. | 1 ✅ |
| `@sentinel-forge/reports` | JSON and Markdown rendering. HTML arrives with the dashboard. | 1 ✅ |
| `@sentinel-forge/analyzer` | Lua, event and database analysis; health scoring. | 2 |
| `@sentinel-forge/performance` | Baselines, samples, regression detection, correlation. | 3 |
| `@sentinel-forge/security` | Secret scanning, obfuscation and remote-load indicators. | 4 |
| `@sentinel-forge/integrity` | Integrity snapshots and comparison. | 4 |
| `@sentinel-forge/runtime` | Ingestion of telemetry from the in-server collector. | 5 |

Dependencies flow one way: `shared` ← `core` ← everything else. `shared` has no
imports outside itself, so contracts can be consumed by the CLI, the report
writer, the dashboard and the MCP server without dragging platform code along.

### Why `shared` is free of I/O

The severity model, the confidence bands and the report schema are contracts
that outlive any particular implementation. Keeping them in a package that
cannot touch the filesystem makes it structurally impossible for a contract to
grow an implicit dependency on how the current scanner happens to work.

## 3. The finding model

A finding is the unit of output. Everything else in the product either produces
findings, stores them, scores them or renders them.

```
Finding
├── id             deterministic; identical input produces an identical id
├── ruleId         published contract, e.g. DEP-MISSING-001
├── category       from the rule catalog, never set by the rule itself
├── severity       INFO | LOW | MEDIUM | HIGH | CRITICAL
├── confidence     0.00–1.00
├── title          neutral headline
├── summary        what was observed
├── recommendation what a human should do next
├── evidence[]     required above INFO severity
├── resource/file/line
├── timestamp
└── metadata
```

**Severity and confidence are independent.** Severity answers "how much does
this matter if it is real"; confidence answers "how sure are we that it is
real". Collapsing them into one number is the most common way a diagnostic tool
becomes untrustworthy: a high-impact guess and a low-impact certainty are not
the same thing, and an operator needs to tell them apart.

Findings are constructed through `createFinding` in `core/rules/finding-builder.ts`,
which enforces four invariants centrally rather than trusting each rule:
the rule id exists in the catalog; the category comes from the catalog; the
confidence is normalized; and anything above INFO carries redacted evidence.

## 4. The rule system

A rule is a pure function from a prepared context to findings. Rules perform no
I/O, so they are testable against fixtures and safe to run in any order.

```ts
interface RuleDefinition<TInput> {
  id: string;
  category: RuleCategory;
  defaultSeverity: Severity;
  description: string;
  rationale: string;
  falsePositives: readonly string[];   // required, not optional
  analyze(context: RuleContext<TInput>): readonly Finding[];
}
```

`falsePositives` is mandatory. In this product a false positive is a defect: an
operator who is told three times that a healthy resource is broken will stop
reading the output, at which point the real finding is also lost. Requiring the
author to enumerate the benign patterns their rule matches makes that cost
visible while the rule is being written.

The catalog in `shared/rules/catalog.ts` is the published list of rule ids, with
each rule's status and the gate that delivers it. The registry cross-checks
every registration against the catalog, so a rule cannot quietly drift from its
published contract.

## 4a. Reading a manifest without running it

A FiveM manifest is a Lua file. The obvious implementation — evaluate it in a
Lua sandbox and read the resulting table — is the one thing this product cannot
do: a manifest belongs to a resource the operator has not yet reviewed, and
executing it is exactly the risk Sentinel Forge exists to reduce.

So the manifest is lexed and parsed as data. The lexer covers the Lua lexical
grammar the format uses (all three string forms, long brackets, comments,
numbers, punctuation); the parser recognises the declarative statement shapes
(`directive 'value'`, `directive { … }`, call syntax, and the two-value
`data_file`) and skips anything else.

Two consequences are deliberate:

- **A manifest that computes a path is not guessed at.** A value built by
  concatenation yields no literal, so the declaration is skipped rather than
  half-reported. Reporting `client.lua` when the source said `'client' .. v ..
  '.lua'` would be a fabricated finding.
- **A broken manifest still yields precise findings.** An unterminated string is
  reported at its opening quote, and the declarations before it stay usable, so
  the operator gets a line number rather than "the file could not be read".

Behaviour that could not be derived from the format itself was verified against
official Cfx.re documentation, and three of those checks changed the
implementation: `/`-prefixed dependency entries are runtime constraints rather
than resources; `ensure` accepts a `[category]` name; and `provide` satisfies
another resource's dependency. Each of those would otherwise have produced false
positives on ordinary servers.

## 5. Evidence

Evidence is what makes a finding inspectable. Each record has a kind
(`FILE_REFERENCE`, `CODE_PATTERN`, `MEASUREMENT`, `FILE_HASH`, `RELATIONSHIP`,
`LOG_ENTRY`, `RUNTIME_EVENT`, `CONFIG_VALUE`), a neutral description, and
whatever locator applies: a file and line, a measured value with its unit and
sample count, a hash pair, a dependency edge.

Evidence records describe observations. They never assert causation. Correlation
between an evidence record and an outcome is expressed by the incident engine
(GATE 3) with an explicit confidence value, and is worded as such.

## 6. Storage

SQLite, local, via Node's bundled `node:sqlite`.

The engine sits behind a `DatabaseDriver` interface. That is not speculative
abstraction: `node:sqlite` is still marked experimental by Node, and if it has
to be replaced with a compiled binding the interface is the only thing that
changes. The interface is synchronous because every candidate backend is, and
because scan writes happen in short, well-defined transactions.

Migrations are forward-only `.sql` files in `database/migrations/`, embedded
into the build by `scripts/generate-migrations.mjs` so a packaged release does
not have to locate a sibling directory at runtime. Each applied migration is
recorded with the checksum of the SQL that ran; editing an already-applied
migration is detected and refused rather than silently corrupting the schema.

Foreign keys are enabled on every connection and cascade from `servers`, which
is what makes `sentinel purge` a single delete rather than a cleanup routine
that can miss a table.

## 7. Filesystem access

Every path that comes from scanned content is untrusted. Manifests declare
paths, configuration files declare paths, and archive contents choose their own
file names.

`core/fs/paths.ts` resolves each one against an explicit root:

1. resolve the candidate to an absolute path;
2. resolve the *real* path, following symlinks, walking up to the nearest
   existing ancestor when the target does not exist yet;
3. verify the result is the root or a descendant of it;
4. reject otherwise, with `SentinelSecurityError` (exit code 4).

Step 2 is the one that matters. A lexical check passes `resources/evil` cleanly
even when it is a symlink to `/etc`.

Reads are bounded by size and restricted to regular files; traversal is bounded
by depth, entry count and a skip list, does not follow symlinks by default, and
deduplicates by real path so a symlink cycle terminates. Every limit that stops
early is reported, so "analysis was incomplete" is visible rather than being
indistinguishable from "nothing found".

## 8. Redaction

Sentinel Forge detects credentials in resource files. It must not become a way
to spread them.

Redaction is applied at three boundaries — log records, error messages, and
evidence excerpts before persistence or rendering — so a value cannot reach
output through a path someone forgot to guard.

The patterns target *known credential formats* rather than general entropy.
Entropy-based redaction removes hashes, resource identifiers and asset ids,
which are exactly the diagnostic content a report exists to carry. Detecting
unknown-format secrets is the job of the secret scanner (SEC-SECRET-001,
GATE 4), which reports a location rather than a value.

## 9. Configuration

Resolution order, highest precedence first: CLI flags, then the nearest
`sentinel.config.json` at or above the working directory, then built-in
defaults.

Environment variables are deliberately absent from that chain. Two identical
commands must behave identically; an invisible environment override makes a
diagnostic result impossible to reproduce from what the operator typed.

Validation is hand-written rather than schema-library driven, for three reasons:
the surface is small, the messages need to be actionable for a server operator
rather than a developer, and the foundation stays dependency-free. Every problem
is reported in one pass.

Defaults are the safe configuration: no network, no telemetry, no AI, no symlink
following, database inside the working directory. Switches for capabilities that
do not exist in a build are rejected rather than accepted and ignored.

## 10. The CLI

`run()` in `apps/cli/src/run.ts` is a pure function of its inputs — argv, cwd,
streams, clock — and returns an exit code rather than calling `process.exit`.
The whole CLI is therefore testable in-process, and the executable in
`bin/sentinel.ts` holds only the process concerns.

stdout carries results; stderr carries logs. That split is what makes
`sentinel <command> --json | jq` reliable. Under `--json`, logs are emitted as
JSON too, so a consumer capturing both streams gets one format.

Every command produces both a text rendering and a JSON payload, so `--json`
never returns less than the human-readable form. Exit codes are a stable
automation contract, documented in `docs/CLI.md`.

## 11. Reports

The JSON report is a versioned integration surface consumed by CI pipelines, MCP
clients and the dashboard. `schemaVersion` is independent of the product
version, and the envelope's field order is the canonical serialization order so
two reports diff readably.

Sections that a run did not produce are absent rather than empty: a consumer
must be able to distinguish "measured, found nothing" from "not measured".
`limitations` is always populated — a report that does not state what it fails
to establish misrepresents its own analysis.

## 12. Runtime collection (GATE 5)

`resources/sentinel_doctor` will collect telemetry from inside a running server.
It is constrained by design: it does not inject code, modify other resources,
download or execute anything, change server configuration, or surveil players.

No FiveM API will be used there until it has been verified against official
Cfx.re documentation and tested. Where an API does not exist, the limitation is
documented and the closest safe alternative is implemented. Runtime data is
never synthesised.

## 13. What is deliberately not here

- **No plugin system.** Rules are compiled in. A diagnostic tool that loads
  third-party code inherits its security properties.
- **No ORM.** The queries are simple and the schema is the contract.
- **No dependency injection container.** Dependencies are passed as arguments.
- **No AI in the analysis path.** AI may explain a finding later; it never
  produces one. Deterministic diagnostics are the product.
