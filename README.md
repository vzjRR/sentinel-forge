# Sentinel Forge

**FiveM Server Intelligence**

Created and developed by Talal Al Ghafri · Developer: vzjRR
© 2026 Talal Al Ghafri. All Rights Reserved.

---

Sentinel Forge is a local-first diagnostic intelligence platform for FiveM
server environments. It reads a server, collects evidence, correlates what it
finds, and explains it.

> Don't just monitor the server. Diagnose it.

Most tooling in this ecosystem answers *what* is happening — CPU is high, a
resource is slow. Sentinel Forge is built to answer the harder questions:

- What is wrong, and where?
- When did it start, and what changed just before?
- Which resources are involved?
- What evidence supports that conclusion, and how confident is it?
- What should be investigated next?

Every finding carries evidence, a severity, and a confidence value. Nothing is
asserted without something to point at.

## What Sentinel Forge is not

It is not an anti-cheat, an antivirus, a malware guarantee, a profiler
replacement, or a replacement for txAdmin or resmon. Security findings are
*indicators* that require human verification; the absence of a finding is not
evidence that a server is safe.

Sentinel Forge is an independent product. It is not affiliated with, endorsed
by, or sponsored by Rockstar Games, Cfx.re, the FiveM project, or txAdmin.

## Current status

**GATE 0 — Foundation. Complete.**

This build contains the repository foundation: shared contracts, configuration,
structured logging with secret redaction, the error model, contained filesystem
access, the local SQLite layer, the rule engine interfaces, the CLI skeleton,
the report schema, test infrastructure and synthetic fixtures.

Analysis itself begins in GATE 1. Commands that belong to a later gate are
present in the CLI and report `NOT IMPLEMENTED` with the gate that delivers
them — they never return an empty or invented result.

See [`docs/GATE_STATUS.md`](docs/GATE_STATUS.md) for exactly what exists today.

| Available now | Delivered by a later gate |
| --- | --- |
| `sentinel init` | `scan`, `report`, `dependencies` (GATE 1) |
| `sentinel doctor` | `health`, `resource` (GATE 2) |
| `sentinel version` | `baseline`, `compare`, `incidents`, `purge` (GATE 3) |
| `sentinel help` | `security`, `integrity` (GATE 4) |

## Requirements

- Node.js **22.5 or newer** (for the bundled `node:sqlite` module)
- No network connection
- No API keys, no cloud service, no AI provider

Sentinel Forge has **no third-party runtime dependencies**. See
[`THIRD_PARTY_LICENSES.md`](THIRD_PARTY_LICENSES.md).

## Getting started

```bash
npm install
npm run build

node apps/cli/dist/bin/sentinel.js init --server "/path/to/fxserver"
node apps/cli/dist/bin/sentinel.js doctor
```

`init` creates `sentinel.config.json`, the local `.sentinel/` data directory and
the SQLite database. It does not modify the FiveM server in any way.

`doctor` verifies that this machine can run Sentinel Forge and that the
configuration is usable, and reports exactly what it checked.

Full command reference: [`docs/CLI.md`](docs/CLI.md).

## Design commitments

These hold for every gate, not just this one.

| Commitment | Meaning |
| --- | --- |
| **Local-first** | Everything stays on the operator's machine. There is no cloud requirement, and no code in the product makes an outbound request. |
| **Read-only** | Sentinel Forge never modifies the server it analyses. |
| **No execution** | Scanned Lua and JavaScript are analysed as text. Nothing found on disk is executed. |
| **No fake data** | If a value was not measured, it is reported as `Unavailable` or `Not collected`, never estimated. |
| **Evidence-backed** | Every finding above INFO carries evidence a human can inspect. |
| **Explainable scores** | Every point deducted from a health score traces to a specific finding. |
| **Secrets redacted** | Detected credentials are reported by location, never by value. |
| **AI optional** | The deterministic engine is the product. AI is off by default and never required. |

## Repository layout

```
apps/cli              Command line interface
apps/dashboard        Local dashboard              (GATE 6)
apps/mcp              Read-only MCP server         (GATE 7)
packages/shared       Types, rule catalog, report schema
packages/core         Config, logging, errors, filesystem, SQLite, rule engine
packages/scanner      Server and manifest scanning (GATE 1)
packages/dependencies Dependency graph             (GATE 1)
packages/analyzer     Lua, event, database, health (GATE 2)
packages/performance  Baselines, regressions       (GATE 3)
packages/security     Secrets, obfuscation         (GATE 4)
packages/integrity    Snapshots and comparison     (GATE 4)
packages/reports      JSON, Markdown, HTML output  (GATE 1)
packages/runtime      Runtime telemetry ingestion  (GATE 5)
resources/sentinel_doctor  In-server collector     (GATE 5)
database/migrations   SQL schema, forward-only
tests/                Unit, integration, security and performance suites
docs/                 Documentation
```

## Documentation

| Document | Contents |
| --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | How the system is put together and why. |
| [SECURITY.md](SECURITY.md) | Security model, threat model, guarantees and limitations. |
| [ROADMAP.md](ROADMAP.md) | Gate plan from foundation to commercial hardening. |
| [docs/CLI.md](docs/CLI.md) | Commands, options, exit codes. |
| [docs/API.md](docs/API.md) | Report schema and finding model. |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | Building, testing, dependency policy. |
| [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md) | What has actually been tested. |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | Common problems and their causes. |
| [docs/GATE_STATUS.md](docs/GATE_STATUS.md) | Delivery status, gate by gate. |
| [docs/RELEASE.md](docs/RELEASE.md) | Versioning, rule stability, release checklist. |
| [docs/LICENSING.md](docs/LICENSING.md) | Ownership and licence terms in plain language. |
| [docs/MCP.md](docs/MCP.md) | Planned read-only MCP interface. |

## Licence

Proprietary. See [`LICENSE`](LICENSE).
