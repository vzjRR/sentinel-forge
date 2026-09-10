# Roadmap

© 2026 Talal Al Ghafri. All Rights Reserved.

Sentinel Forge is built in gates. A gate is complete only when its
implementation exists, its tests pass, lint and typecheck pass, the build passes,
its security implications have been reviewed, its documentation is updated, its
limitations are written down, and no placeholder functionality remains.

Current delivery status: [`docs/GATE_STATUS.md`](docs/GATE_STATUS.md).

| Gate | Scope | Status |
| --- | --- | --- |
| 0 | Foundation | **Complete** |
| 1 | Static scanner | Not started |
| 2 | Diagnostic engine | Not started |
| 3 | Performance intelligence | Not started |
| 4 | Security and integrity | Not started |
| 5 | Runtime resource | Not started |
| 6 | Dashboard | Not started |
| 7 | MCP interface | Not started |
| 8 | Commercial hardening | Not started |

## GATE 0 — Foundation *(complete)*

Repository, package structure, TypeScript configuration, shared contracts,
configuration system, structured logging, redaction, error model, CLI skeleton,
SQLite abstraction and migrations, rule interfaces, contained filesystem
utilities, report schema, test infrastructure, synthetic fixtures, documentation.

## GATE 1 — Static scanner

Server discovery; resource discovery; `fxmanifest.lua` and `__resource.lua`
parsing; missing-file detection; dependency extraction and graph construction;
configuration checks; JSON and Markdown reports.

Rules: `CFG-MANIFEST-001`, `CFG-MISSING-FILE-001`, `DEP-MISSING-001`,
`DEP-CYCLE-001`. Commands: `scan`, `dependencies`, `report`.

## GATE 2 — Diagnostic engine

Lua static analysis; event graph analysis; database query analysis; health
scoring with traceable deductions; the evidence and finding engines end to end.

Rules: `PERF-LOOP-001`, `PERF-EVENT-001`, `PERF-QUERY-001`.
Commands: `health`, `resource`.

## GATE 3 — Performance intelligence

Baseline creation and storage; performance sample storage; baseline comparison;
regression detection using absolute and relative thresholds with sample counts
and variance; the correlation and incident engines; data retention and purge.

Rules: `PERF-REGRESSION-001`. Commands: `baseline`, `compare`, `incidents`,
`purge`.

## GATE 4 — Security and integrity

Secret scanning with redaction; obfuscation indicators; remote-load detection;
suspicious file detection; integrity snapshots and comparison.

Rules: `SEC-SECRET-001`, `SEC-WEBHOOK-001`, `SEC-OBFUSCATION-001`,
`SEC-REMOTE-LOAD-001`, `SEC-DYNAMIC-EXEC-001`, `SEC-SUSPICIOUS-FILE-001`,
`INT-CHANGE-001`. Commands: `security`, `integrity`.

## GATE 5 — Runtime resource

`resources/sentinel_doctor`: safe runtime telemetry, resource state monitoring,
event-driven collection, and mandatory overhead benchmarks. Every FiveM API used
is verified against official documentation and tested first; unavailable APIs are
documented as limitations rather than worked around with invented data.

Significant runtime overhead is a release blocker.

## GATE 6 — Dashboard

Local-first web dashboard: server overview, resources, resource detail,
performance, incidents, security, dependencies, integrity, reports, settings.
Binds to `127.0.0.1` and is not exposed by default.

## GATE 7 — MCP interface

Optional, read-only MCP server exposing `sentinel_scan`, `sentinel_health`,
`sentinel_resource`, `sentinel_dependencies`, `sentinel_performance`,
`sentinel_compare`, `sentinel_security`, `sentinel_integrity`,
`sentinel_incidents`, `sentinel_report`.

It cannot edit files, execute commands, restart or delete resources, install
software, or modify server configuration.

## GATE 8 — Commercial hardening

Only after the MVP is proven in real use: packaging, licensing, update
mechanism, optional cloud, CI and Git integrations, safe patch proposals behind
mandatory human approval, and optional local AI explanation.

## Deliberately not planned

Payment or subscription systems before product validation; mandatory cloud;
mandatory AI; automatic patching of production; player surveillance; anti-cheat
claims; malware-detection guarantees.

## MVP definition

The MVP is reached when an operator can point Sentinel Forge at a FiveM server
and receive: a server health score, resource health scores, broken-resource and
missing-dependency detection, a dependency graph, Lua performance warnings,
event and database analysis, security indicators, secret detection with
redaction, obfuscation indicators, an integrity snapshot, a performance
baseline, regression detection, an incident timeline, evidence-backed findings,
JSON/Markdown/HTML reports, a local dashboard and an optional read-only MCP
interface — without Claude, OpenAI, Gemini, paid APIs, cloud services, mandatory
internet, telemetry, or any automatic modification of the server.
