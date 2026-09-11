# CLI reference

© 2026 Talal Al Ghafri. All Rights Reserved.

```
sentinel <command> [options]
```

The CLI is an automation contract: exit codes, JSON payload shapes and rule ids
are stable within a major version. Anything not available in the current build
says so explicitly and names the gate that delivers it.

## Commands

### Available in this build

| Command | Description |
| --- | --- |
| `sentinel init` | Create `sentinel.config.json`, the `.sentinel/` data directory and the local database. |
| `sentinel scan` | Scan a server and report findings. Records the result locally. |
| `sentinel dependencies` | Show the dependency graph, unresolved edges and cycles. |
| `sentinel report` | Write a JSON, Markdown or HTML report. |
| `sentinel health` | Show the explainable server health score. |
| `sentinel resource <name>` | Show health, findings, dependencies and events for one resource. |
| `sentinel baseline <create\|list\|show\|delete>` | Record and inspect baselines. |
| `sentinel compare <a> <b>` | Compare two baselines and report what changed. |
| `sentinel incidents` | List correlated incidents and their timelines. |
| `sentinel security` | Show security indicators with evidence and confidence. |
| `sentinel integrity <snapshot\|list\|compare\|delete>` | File integrity snapshots and comparison. |
| `sentinel runtime <status\|import\|events>` | Import and inspect telemetry measured by the in-server collector. |
| `sentinel dashboard` | Serve the local, read-only dashboard. Runs until interrupted. |
| `sentinel mcp` | Serve the read-only MCP interface on stdio. Runs until the client disconnects. |
| `sentinel purge [retention\|all]` | Delete locally stored data. Dry run unless `--confirm`. |
| `sentinel doctor` | Check that this environment can run Sentinel Forge. |
| `sentinel version` | Print product, report schema and database schema versions. |
| `sentinel help [command\|rules]` | Show usage, a command's help, or the rule catalog. |

Every command named in the product specification is implemented in this build.

A command belonging to a later gate would still appear here, reporting
`NOT IMPLEMENTED` with the gate that delivers it and exiting with code `2` — it
is never confused with an unknown command, and never returns an empty result.

## Options

| Option | Value | Description |
| --- | --- | --- |
| `--json` | | Write machine-readable JSON to stdout. |
| `--quiet`, `-q` | | Suppress log output. Results are still written. |
| `--verbose` | | Enable debug logging on stderr. |
| `--server` | path | Path to the FiveM server root. |
| `--output`, `-o` | path | Write output to a file instead of stdout. |
| `--format` | `json`\|`markdown`\|`html` | Report output format. HTML is one self-contained file: the stylesheet is embedded and no script, font or image is loaded. |
| `--host` | address | Interface the dashboard listens on. Default `127.0.0.1`. |
| `--port` | number | Port the dashboard listens on. Default `7878`; `0` picks a free port. |
| `--refresh` | seconds | How long a dashboard scan stays current. `0` scans once at startup. |
| `--allow-non-loopback` | | Permit the dashboard to bind an address reachable from the network. It has no authentication. |
| `--config` | path | Path to `sentinel.config.json`. |
| `--database` | path | Path to the local SQLite database. |
| `--confirm` | | Carry out a destructive operation. Without it, such commands only report what they would do. |
| `--help`, `-h` | | Show help for a command. |
| `--version`, `-V` | | Print the product version. |

`--option value` and `--option=value` are equivalent. Everything after `--` is
treated as a positional argument. An unknown option is an error, never ignored:
a typo in a scripted invocation must not silently change behaviour.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Success. No findings above the configured threshold. |
| `1` | Findings detected. The command completed and reported findings. This is not an error. |
| `2` | Invalid input, invalid configuration, or an operation this build does not provide. |
| `3` | Internal error. An error id is included in the output. |
| `4` | Security-sensitive failure: a path escaped its root, or redaction could not be guaranteed. The operation was stopped rather than completed unsafely. |

Exit codes are stable within a major version. In CI, treat `1` as "findings to
review" and `2`–`4` as a tooling failure.

## Streams

stdout carries results. stderr carries logs. This split is what makes
`sentinel <command> --json | jq` reliable.

Under `--json`, log records are JSON too, so capturing both streams gives one
parseable format.

## JSON output

Success:

```json
{
  "ok": true,
  "command": "doctor",
  "exitCode": 0,
  "checks": [ ... ],
  "summary": { "total": 7, "failed": 0, "warnings": 1 }
}
```

Failure:

```json
{
  "ok": false,
  "command": "health",
  "error": {
    "errorId": "SF-1A2B3C4D",
    "category": "NOT_IMPLEMENTED",
    "message": "`sentinel health` is NOT IMPLEMENTED in this build (planned for GATE 2).",
    "exitCode": 2,
    "remediation": "Track delivery in docs/GATE_STATUS.md."
  }
}
```

`errorId` correlates the message with the corresponding log record. Quote it
when reporting a problem; it contains no path or credential.

## Configuration

`sentinel.config.json` is searched for at, then above, the working directory.
CLI flags take precedence over the file; the file takes precedence over the
built-in defaults. Environment variables are deliberately not part of this
chain, so that two identical commands behave identically.

```jsonc
{
  "server":   { "path": null, "resourceDirectories": ["resources"] },
  "database": { "path": ".sentinel/sentinel.db" },
  "scan": {
    "maxFileBytes": 4194304,
    "maxDepth": 24,
    "maxFiles": 200000,
    "followSymlinks": false,
    "skipDirectories": [".git", "node_modules", "cache"]
  },
  "analysis": {
    "minimumSeverity": "INFO",
    "failOnSeverity": "HIGH",
    "disabledRules": []
  },
  "logging":   { "level": "INFO", "format": "pretty" },
  "reports":   { "outputDirectory": ".sentinel/reports" },
  "retention": {
    "performanceSampleDays": 30,
    "scanRunDays": 90,
    "incidentDays": 180,
    "integritySnapshotDays": 90
  },
  "privacy": { "telemetry": false, "network": false, "ai": false }
}
```

Every value is validated. Unknown sections, out-of-range numbers, unknown rule
ids in `disabledRules`, and any attempt to enable a capability this build does
not have are all reported — all of them at once, not one per run.

## Scanning

```bash
sentinel scan --server "/opt/fxserver"
```

`scan` discovers resources, parses every manifest, resolves the dependency
graph, checks the server configuration, and reports findings with evidence. The
result is recorded in the local database so later gates can compare against it.

Nothing in the scanned server is executed, and nothing is modified.

Exit code `1` means findings reached `analysis.failOnSeverity` (default `HIGH`).
That is a result, not an error — in CI, treat `1` as "findings to review" and
`2`–`4` as a tooling failure:

```bash
sentinel scan --server "$SERVER" --json > findings.json
case $? in
  0) echo "clean" ;;
  1) echo "findings to review" ;;
  *) echo "sentinel failed" && exit 1 ;;
esac
```

`scan --format json` and `scan --format markdown` write the full report to
stdout instead of the summary, so a pipeline does not need a second scan.

### What a scan reports in this build

| Rule | Detects |
| --- | --- |
| `CFG-MANIFEST-001` | A resource with no manifest; a manifest that cannot be parsed; a missing or unrecognised `fx_version` or `game`; the legacy `__resource.lua` format (INFO). |
| `CFG-MISSING-FILE-001` | A script, file or `ui_page` declaration that matches nothing on disk. |
| `CFG-ENSURE-MISSING-001` | An `ensure`/`start`/`restart` naming a resource that was not found. |
| `DEP-MISSING-001` | A declared dependency, or an `@resource/file` reference, that does not resolve. |
| `DEP-CYCLE-001` | A cycle in the dependency graph. |
| `PERF-LOOP-001` | A continuous loop with no observable yield. `Wait(0)` yields, and is not reported. |
| `PERF-EVENT-001` | A network event triggered from a per-frame loop. |
| `PERF-QUERY-001` | A query executed per loop iteration; a SELECT with no WHERE or LIMIT; `SELECT *` (INFO). |

Security indicators are reported by `sentinel scan` and by `sentinel security`.
Integrity is not part of a single scan: it is a comparison between two
snapshots, so its report section is absent rather than empty and the matching
health category is reported as unavailable rather than scored.

## Health

```bash
sentinel health --server "/opt/fxserver"
```

```
Health: 75/100  ###############.....

Capped: A high-confidence HIGH finding caps the score at 75: Declared dependency was not found.

  PERFORMANCE     81/100  ##########..  1 finding(s)
  DEPENDENCIES    67/100  ########....  2 finding(s)
  CONFIGURATION  100/100  ############  0 finding(s)

Not scored:
  RELIABILITY    Reliability is not scored: FiveM exposes no scripting API for
                 runtime errors, so none are collected. Resource state
                 transitions the collector observed are shown by
                 `sentinel runtime events`.
```

Every deduction names the finding that caused it, and the deductions in a
category sum to that category's score. A category with no analysis behind it is
listed as unavailable rather than given a value — scoring what was never
measured would claim a result that does not exist.

See [API.md](API.md) for the point values, the category weights and the caps.

## Baselines and comparison

This is the workflow the product is built around: record what the server looked
like, make a change, record it again, and ask what moved.

```bash
sentinel baseline create before-update
#   ... update a resource ...
sentinel baseline create after-update
sentinel compare before-update after-update
```

```
Comparing "before-update" with "after-update"

  Resources changed    1
  Configuration        unchanged
  Findings introduced  1
  Health               100 -> 75 (-25)
  Incidents            1

Resource changes:
  MODIFIED  sf_core
            File contents changed.

Findings introduced:
  HIGH     PERF-LOOP-001   Loop without an observable yield [sf_core]

Incidents:
  MEDIUM   confidence 0.85
           1 change(s) and 2 effect(s) were observed in the same window. …
           Temporal correlation does not establish causation; these observations
           are related in time and require verification.
           → Inspect what changed in sf_core during this window.
```

A baseline records resource content hashes, the configuration fingerprint, the
findings that stood and the health score.

**Performance samples are recorded only if something collected them.** They come
from the `sentinel_doctor` collector by way of `sentinel runtime import`, and a
baseline claims the samples collected since the previous one — which is what
makes the two sides of a comparison two measurement windows rather than two
arbitrary slices of history.

On a server with no collector installed, a baseline reports zero samples, and
`compare` states that performance was not compared rather than implying that no
regression was found.

### Regression detection

When samples exist on both sides, a change is only reported as a regression if
it clears every guard:

| Guard | Default |
| --- | --- |
| Absolute increase | ≥ 0.2 ms — a large percentage on a tiny value is not a regression |
| Relative increase | ≥ 50% |
| Samples per side | ≥ 8 |
| Baseline stability | Coefficient of variation ≤ 0.75 |

Anything that fails a guard is reported with the reason (`BELOW_ABSOLUTE_THRESHOLD`,
`INSUFFICIENT_SAMPLES`, `BASELINE_TOO_NOISY`, `CONTEXT_MISMATCH`), never silently
dropped.

## Incidents

```bash
sentinel incidents
```

An incident groups changes and effects observed in the same window, with a
timeline, the resources involved and a confidence that they are related.
Confidence is capped at 0.85: **an incident never names a cause.**

## Dashboard

```bash
sentinel dashboard                      # http://127.0.0.1:7878/
sentinel dashboard --port 9000
sentinel dashboard --refresh 0          # scan once at startup, never again
```

A local web interface over the same data every other command reports. It runs
until you interrupt it with Ctrl-C.

### Pages

| Path | Shows |
| --- | --- |
| `/` | Health, counts, the most severe findings, and what has been recorded. |
| `/server` | Identity, the full health breakdown with every deduction, and the parsed configuration. |
| `/resources` | Every discovered resource, ordered by finding count. |
| `/resources/<name>` | One resource: findings with evidence, dependencies both ways, scripts analysed, files with content hashes. |
| `/dependencies` | The graph, unresolved edges and cycles. |
| `/performance` | What the collector measured, the baselines recorded, and static performance findings — kept apart. |
| `/security` | Security indicators with evidence and confidence. |
| `/integrity` | Integrity snapshots. |
| `/incidents` | Correlated incidents and the runtime events the collector observed. |
| `/reports` | The current scan rendered as HTML, JSON or Markdown. |
| `/settings` | What this session is reading, and what this interface can and cannot do. |

Every page states when the data it shows was produced, and whether it came from
a scan or from the local database.

### JSON API

Every page has a JSON equivalent under `/api`, serving the same data:
`/api/health`, `/api/server`, `/api/resources`, `/api/resources/<name>`,
`/api/dependencies`, `/api/performance`, `/api/security`, `/api/integrity`,
`/api/incidents`, `/api/reports`, `/api/settings`.

The dashboard is not a privileged consumer of its own product: anything a page
shows can be fetched, scripted and diffed.

### What it cannot do

| | |
| --- | --- |
| Modify the FiveM server | No. Nothing in Sentinel Forge writes to it. |
| Run a command against the server | No. |
| Change configuration | No. Edit `sentinel.config.json`. |
| Accept a request that is not GET or HEAD | No — refused with `405` before routing. |
| Serve a file from disk | No. There is no static directory and no path to traverse. |
| Reach the network | No. Pages load no script, font, image or analytics. |

### Security

The dashboard has **no authentication**, so it binds `127.0.0.1` and refuses any
other address unless you pass `--allow-non-loopback`. The refusal exits `4`.

Requests are checked against the `Host` header before routing: a page on another
origin cannot point a DNS name at `127.0.0.1` and read your dashboard.

Every response carries `Content-Security-Policy: default-src 'none'` with inline
styles permitted and nothing else, plus `nosniff`, `DENY` framing, `no-referrer`
and `no-store`. No CORS header is ever sent.

Configuration values are withheld before they reach a page or an endpoint —
by key name and by the product's own credential detector. `sv_licenseKey` is
shown as a name with `(redacted)` where its value would be.

### Refresh

A scan is taken before the port opens, and re-taken when a request arrives more
than `--refresh` seconds later (default 300). The browser never triggers a scan
itself; the policy is the server's. Concurrent requests share one scan rather
than starting several.

## Runtime telemetry

```bash
sentinel runtime status     # is the collector installed, and what has it written?
sentinel runtime import     # read its telemetry into the local database
sentinel runtime events     # resource state transitions it observed
```

`sentinel_doctor` is a small server-side FiveM resource shipped in
`resources/sentinel_doctor`. Copy it into the server's resources directory, add
`ensure sentinel_doctor` to `server.cfg`, and it begins measuring. It writes
telemetry into its own directory; nothing is sent anywhere.

### What is measured

| Signal | How |
| --- | --- |
| Scheduler latency | How much later than requested the collector's thread was serviced. |
| Resource state | Swept periodically, and on every start and stop. |
| Resource transitions | Event-driven, from `onResourceStart` and `onResourceStop`. |
| Player count | A count only. |

### What is not measured

**Per-resource CPU and tick time.** FiveM exposes no scripting API for it: the
official profiler is a console command that writes a file and cannot be driven
from a script. Sentinel Forge therefore reports no per-resource timing anywhere.
A fabricated number would corrupt every baseline and regression comparison built
on it, which is worse than reporting nothing.

Scheduler latency is the closest honest alternative. It is a real property of
the server, measured from inside it, and it moves for the same reasons an
operator experiences hitching — but it does not identify which resource made the
server late.

### Importing

`sentinel runtime import` is safe to run on a timer. The collector writes into a
fixed rotation of file names, so the same measurements are on disk across
several imports; each document is identified by a digest over its measurements
and imported once.

The server must have been scanned at least once (`sentinel scan`) before
telemetry can be imported: samples belong to a server, and a server is
identified by a scan. Importing for an unscanned server exits `2` and says so.

A corrupt or unreadable telemetry file is reported by name and skipped — the
files either side of it are still imported. Telemetry written by a newer
collector than this build understands is refused rather than guessed at.

Anything the collector had to drop because a buffer was full is reported as a
drop. A gap in the data is shown as a gap, never as a quiet period.

### Privacy

The collector records a player **count** and nothing else about players. No
identifier, name, endpoint, position or action is read or stored, by the
collector or by anything downstream of it.

## MCP interface

```bash
sentinel mcp --server /opt/fxserver
```

Speaks the Model Context Protocol over stdio, so an MCP client can launch this
command as a subprocess and read a diagnosis from it. It runs until the client
closes its input.

```jsonc
{
  "mcpServers": {
    "sentinel-forge": {
      "command": "sentinel",
      "args": ["mcp", "--server", "/opt/fxserver"]
    }
  }
}
```

Ten tools, all read-only: `sentinel_scan`, `sentinel_health`,
`sentinel_resource`, `sentinel_dependencies`, `sentinel_performance`,
`sentinel_compare`, `sentinel_security`, `sentinel_integrity`,
`sentinel_incidents`, `sentinel_report`.

Nothing here can modify the FiveM server, execute anything, change
configuration, or reach the network. Every result carries a `limitations` array,
so an assistant explaining a finding has what it needs to avoid presenting an
observation as a proof.

`--json` is refused: the stdio transport reserves stdout for protocol messages,
and a result written there would corrupt the session. Logs go to stderr.

Full contract: [MCP.md](MCP.md).

## Purge

```bash
sentinel purge              # dry run: reports what would be deleted
sentinel purge --confirm    # expire records past their retention windows
sentinel purge all --confirm
```

Purge is a dry run unless `--confirm` is passed, and only ever touches Sentinel
Forge's own database. The FiveM server is never modified.

## Security

```bash
sentinel security --server "/opt/fxserver"
```

Reports embedded credentials, webhook endpoints, obfuscation indicators, remote
code loading, dynamic execution and unexpected file types, grouped by severity
with evidence and confidence.

**A detected credential is reported by location. The value is never stored,
logged or displayed** — not in output, not in a report, not in the local
database:

```
HIGH
  SEC-SECRET-001    Embedded credential indicator
    confidence 0.90 (Very high) [sf_leaky] resources/sf_leaky/server.lua:11
    An API key is written into sf_leaky. Anyone who obtains this resource
    obtains the credential.
    evidence: An API key was detected in this file. (resources/sf_leaky/server.lua:11)
    → Move the value into server configuration outside the resource, and rotate
      it if the resource has been distributed. The value itself is not recorded
      by Sentinel Forge.
```

Confidence reflects how likely the value is to be live. A value marked as an
example, or one with almost no character variety, scores low — example
configuration is the most common source of false positives here.

Every run prints the standing limitation:

> Security findings are indicators and do not guarantee malware detection.
> Absence of a finding is not evidence of safety.

Obfuscation is reported as blocking review, not as wrongdoing: commercial
resources are routinely obfuscated for licence protection.

## Integrity

```bash
sentinel integrity snapshot before-update
#   ... update a resource ...
sentinel integrity snapshot after-update
sentinel integrity compare before-update after-update
```

```
  Added                   1
  Modified                1
  Deleted                 1
  Touched (same content)  2
  Unchanged               0

Modified:
  resources/sf_core/server/main.lua
      Content hash changed from af2d37600b0c to ffead719f441.
      Size changed from 122 to 209 bytes.
```

A file whose modification time changed but whose content did not is reported as
**touched**, separately from a real change — otherwise a routine file copy would
bury the changes that matter.

**Files are never quarantined, moved, modified or deleted.**

If the `sentinel_doctor` collector is installed, the telemetry files it writes
appear in every snapshot and change between them — that is what a rotating
telemetry directory is. They are **not** excluded from integrity tracking:
hiding a directory from the integrity check because its contents are expected to
change is exactly the hole an attacker would want. Expect
`resources/sentinel_doctor/telemetry/*.json` among the modified files, and read
the rest of the list.

## Resource detail

```bash
sentinel resource sf_shop --server "/opt/fxserver"
```

Shows one resource's health with its deductions, its findings with evidence,
what it depends on, what depends on it, and the events it registers and
triggers.

## Dependencies

```bash
sentinel dependencies --server "/opt/fxserver"
```

Edges come from declared dependencies and from `@resource/file` references
discovered in manifests. Two behaviours are worth knowing:

- a resource declaring `provide 'name'` satisfies other resources' dependencies
  on `name`, so a drop-in replacement does not read as a missing dependency;
- dependency entries beginning with `/` (`/server:5104`, `/onesync`,
  `/gameBuild:h4`) are runtime constraints rather than resources, and are listed
  separately instead of being resolved.

## Reports

```bash
sentinel report --server "/opt/fxserver" --format json --output report.json
sentinel report --server "/opt/fxserver" --format markdown          # to stdout
sentinel report --server "/opt/fxserver" --format html --output report.html
```

JSON is the canonical form and is validated against the published schema before
it is written. See [API.md](API.md).

HTML is one self-contained file: the stylesheet is embedded and the document
loads no script, no font and no image. It renders identically on a machine with
no network access, and it carries a content security policy that permits no
outbound request — so a report can be attached to a ticket or emailed without
becoming a way to reach the reader's browser.

## Examples

```bash
# Prepare a working directory for a server
sentinel init --server "/opt/fxserver"

# Confirm the environment is usable, as JSON, for a setup script
sentinel doctor --json

# Scan and keep only the findings
sentinel scan --server "/opt/fxserver" --json | jq '.findings[] | {ruleId, severity, file, line}'

# Inspect the rule catalog and each rule's delivery status
sentinel help rules --json

# Help for one command
sentinel scan --help
```
