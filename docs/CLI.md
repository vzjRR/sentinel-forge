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
| `sentinel report` | Write a JSON or Markdown report. |
| `sentinel health` | Show the explainable server health score. |
| `sentinel resource <name>` | Show health, findings, dependencies and events for one resource. |
| `sentinel baseline <create\|list\|show\|delete>` | Record and inspect baselines. |
| `sentinel compare <a> <b>` | Compare two baselines and report what changed. |
| `sentinel incidents` | List correlated incidents and their timelines. |
| `sentinel purge [retention\|all]` | Delete locally stored data. Dry run unless `--confirm`. |
| `sentinel doctor` | Check that this environment can run Sentinel Forge. |
| `sentinel version` | Print product, report schema and database schema versions. |
| `sentinel help [command\|rules]` | Show usage, a command's help, or the rule catalog. |

### Declared, delivered by a later gate

| Command | Gate |
| --- | --- |
| `sentinel security` | 4 |
| `sentinel integrity <snapshot\|compare>` | 4 |

Invoking one of these exits with code `2` and a message naming the gate. It is
never confused with an unknown command, and never returns an empty result.

## Options

| Option | Value | Description |
| --- | --- | --- |
| `--json` | | Write machine-readable JSON to stdout. |
| `--quiet`, `-q` | | Suppress log output. Results are still written. |
| `--verbose` | | Enable debug logging on stderr. |
| `--server` | path | Path to the FiveM server root. |
| `--output`, `-o` | path | Write output to a file instead of stdout. |
| `--format` | `json`\|`markdown` | Report output format. `html` is NOT IMPLEMENTED and is delivered with the dashboard in GATE 6. |
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

Security and integrity analysis are NOT IMPLEMENTED in this build; those report
sections are absent rather than empty, and the matching health categories are
reported as unavailable rather than scored.

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
  SECURITY       Security analysis is NOT IMPLEMENTED in this build (GATE 4).
  INTEGRITY      Integrity tracking is NOT IMPLEMENTED in this build (GATE 4).
  RELIABILITY    Runtime error data is NOT IMPLEMENTED in this build (GATE 5).
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

**Performance samples are recorded only if something collected them.** No
runtime collector exists before GATE 6, so a baseline taken by this build
reports zero samples, and `compare` states that performance was not compared
rather than implying that no regression was found.

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

## Purge

```bash
sentinel purge              # dry run: reports what would be deleted
sentinel purge --confirm    # expire records past their retention windows
sentinel purge all --confirm
```

Purge is a dry run unless `--confirm` is passed, and only ever touches Sentinel
Forge's own database. The FiveM server is never modified.

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
```

JSON is the canonical form and is validated against the published schema before
it is written. See [API.md](API.md).

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
