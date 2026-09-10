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

**GATE 1 — Static scanner. Complete.**

Sentinel Forge can now scan a FiveM server: it discovers resources, parses every
manifest without executing it, resolves the dependency graph, checks the server
configuration, and reports findings with evidence, severity and confidence.
Results are recorded locally and can be written as JSON or Markdown.

Commands that belong to a later gate are present in the CLI and report
`NOT IMPLEMENTED` with the gate that delivers them — they never return an empty
or invented result.

See [`docs/GATE_STATUS.md`](docs/GATE_STATUS.md) for exactly what exists today.

| Available now | Delivered by a later gate |
| --- | --- |
| `sentinel scan` | `health`, `resource` (GATE 2) |
| `sentinel dependencies` | `baseline`, `compare`, `incidents`, `purge` (GATE 3) |
| `sentinel report` | `security`, `integrity` (GATE 4) |
| `sentinel init`, `doctor`, `version`, `help` | dashboard (GATE 6), MCP (GATE 7) |

Five rules are implemented and run against every scan:

| Rule | Detects |
| --- | --- |
| `CFG-MANIFEST-001` | Missing, unparsable or incomplete resource manifests. |
| `CFG-MISSING-FILE-001` | Manifest declarations that match no file on disk. |
| `CFG-ENSURE-MISSING-001` | `ensure`/`start` naming a resource that was not found. |
| `DEP-MISSING-001` | Declared and discovered dependencies that do not resolve. |
| `DEP-CYCLE-001` | Cycles in the dependency graph. |

Performance, security, integrity and health analysis are not implemented yet;
those report sections are absent rather than empty.

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

sentinel="node apps/cli/dist/bin/sentinel.js"

$sentinel init --server "/path/to/fxserver"
$sentinel doctor
$sentinel scan
```

`init` creates `sentinel.config.json`, the local `.sentinel/` data directory and
the SQLite database. It does not modify the FiveM server in any way.

`doctor` verifies that this machine can run Sentinel Forge and that the
configuration is usable, and reports exactly what it checked.

`scan` produces the diagnosis:

```
Scanned /opt/fxserver

  Resources     5
  Files         14
  Dependencies  3
  Unresolved    1
  Cycles        1
  Findings      2

  HIGH     DEP-MISSING-001          Declared dependency was not found
           confidence 0.95 (Very high) [sf_shop] resources/sf_shop/fxmanifest.lua:7
           "sf_shop" declares a dependency on "sf_inventory", which was not found.
           → Install or enable "sf_inventory", or remove the reference if it is obsolete.
```

Exit code `1` means findings reached the configured threshold — a result, not an
error. Full command reference: [`docs/CLI.md`](docs/CLI.md).

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
packages/scanner      Server discovery, manifests, configuration analysis
packages/dependencies Dependency graph and analysis
packages/reports      JSON and Markdown rendering
packages/analyzer     Lua, event, database, health (GATE 2)
packages/performance  Baselines, regressions       (GATE 3)
packages/security     Secrets, obfuscation         (GATE 4)
packages/integrity    Snapshots and comparison     (GATE 4)
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
