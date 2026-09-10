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
| `sentinel doctor` | Check that this environment can run Sentinel Forge. |
| `sentinel version` | Print product, report schema and database schema versions. |
| `sentinel help [command\|rules]` | Show usage, a command's help, or the rule catalog. |

### Declared, delivered by a later gate

| Command | Gate |
| --- | --- |
| `sentinel scan` | 1 |
| `sentinel dependencies` | 1 |
| `sentinel report` | 1 |
| `sentinel health` | 2 |
| `sentinel resource <name>` | 2 |
| `sentinel baseline <create\|list\|show>` | 3 |
| `sentinel compare <a> <b>` | 3 |
| `sentinel incidents` | 3 |
| `sentinel purge` | 3 |
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
| `--format` | `json`\|`markdown`\|`html` | Report output format. |
| `--config` | path | Path to `sentinel.config.json`. |
| `--database` | path | Path to the local SQLite database. |
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
  "command": "scan",
  "error": {
    "errorId": "SF-1A2B3C4D",
    "category": "NOT_IMPLEMENTED",
    "message": "`sentinel scan` is NOT IMPLEMENTED in this build (planned for GATE 1).",
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

## Examples

```bash
# Prepare a working directory for a server
sentinel init --server "/opt/fxserver"

# Confirm the environment is usable, as JSON, for a setup script
sentinel doctor --json

# Inspect the rule catalog and each rule's delivery status
sentinel help rules --json

# Help for one command
sentinel scan --help
```
