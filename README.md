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

**GATE 4 — Security and integrity. Complete.**

Sentinel Forge scans a FiveM server, diagnoses it, and tracks it over time. It
parses manifests and scripts without executing them, resolves the dependency
graph, analyses loops, events and database access, detects security indicators,
tracks file integrity, produces an explainable health score, and — the part it
exists for — compares two points in time to answer *what changed, and what
followed*.

Commands that belong to a later gate are present in the CLI and report
`NOT IMPLEMENTED` with the gate that delivers them — they never return an empty
or invented result.

See [`docs/GATE_STATUS.md`](docs/GATE_STATUS.md) for exactly what exists today.

Every command in the product specification is implemented:
`scan`, `health`, `resource`, `dependencies`, `baseline`, `compare`,
`incidents`, `security`, `integrity`, `report`, `purge`, `init`, `doctor`,
`version`, `help`.

Still to come: the in-server runtime collector (GATE 5), the local dashboard
(GATE 6) and the read-only MCP interface (GATE 7).

Sixteen rules are implemented and run against every scan:

| Rule | Detects |
| --- | --- |
| `CFG-MANIFEST-001` | Missing, unparsable or incomplete resource manifests. |
| `CFG-MISSING-FILE-001` | Manifest declarations that match no file on disk. |
| `CFG-ENSURE-MISSING-001` | `ensure`/`start` naming a resource that was not found. |
| `DEP-MISSING-001` | Declared and discovered dependencies that do not resolve. |
| `DEP-CYCLE-001` | Cycles in the dependency graph. |
| `PERF-LOOP-001` | Continuous loops with no observable yield. `Wait(0)` yields — it is not reported. |
| `PERF-EVENT-001` | Network events triggered from a per-frame loop. |
| `PERF-QUERY-001` | Queries per loop iteration, unbounded SELECTs, `SELECT *`. |
| `PERF-REGRESSION-001` | Timing regressions between baselines, guarded against noise and tiny absolute values. |
| `SEC-SECRET-001`, `SEC-WEBHOOK-001` | Embedded credentials and webhook endpoints, reported by location — never by value. |
| `SEC-OBFUSCATION-001` | Obfuscation indicators: code that cannot be reviewed, not code assumed to be malicious. |
| `SEC-REMOTE-LOAD-001`, `SEC-DYNAMIC-EXEC-001` | Remote code loading and dynamic execution. |
| `SEC-SUSPICIOUS-FILE-001` | Executables and other file types a resource does not normally contain. |
| `INT-CHANGE-001` | Files added, modified or deleted between integrity snapshots. |

Runtime measurement is not implemented yet, so the `RELIABILITY` health category
is reported as unavailable rather than scored, and a baseline records zero
performance samples.

### Finding a credential without copying it

```bash
sentinel security
```

```
HIGH
  SEC-SECRET-001    Embedded credential indicator
    confidence 0.90 (Very high) [sf_leaky] resources/sf_leaky/server.lua:11
    → Move the value into server configuration outside the resource, and rotate
      it if the resource has been distributed. The value itself is not recorded
      by Sentinel Forge.
```

The value is never written to output, to a report, or to the local database —
a test extracts every planted credential from the fixture and asserts it appears
in none of them, while the finding still reports the file and line.

### What changed, and what followed

```bash
sentinel baseline create before-update
#   ... update a resource ...
sentinel baseline create after-update
sentinel compare before-update after-update
```

```
Resource changes:
  MODIFIED  sf_core — file contents changed

Findings introduced:
  HIGH     PERF-LOOP-001   Loop without an observable yield [sf_core]

Health: 100 -> 75 (-25)

Incidents:
  MEDIUM   confidence 0.85
           Temporal correlation does not establish causation; these observations
           are related in time and require verification.
           → Inspect what changed in sf_core during this window.
```

Timing measurement needs the runtime collector (GATE 5). Until then a baseline
records zero performance samples and says so — it never estimates a number it
did not measure.

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
$sentinel health
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
packages/lua          Lua lexing and block structure
packages/analyzer     Lua, event and database analysis; health scoring
packages/engine       The scan pipeline
packages/performance  Baselines, statistics, regression detection
packages/incidents    Change correlation and incident timelines
packages/security     Secret, obfuscation and execution indicators
packages/integrity    File integrity snapshots and comparison
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
