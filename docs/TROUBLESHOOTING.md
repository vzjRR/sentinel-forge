# Troubleshooting

© 2026 Talal Al Ghafri. All Rights Reserved.

Start with:

```bash
sentinel doctor
```

It reports what it actually checked and what failed, rather than a generic
status.

## Installation and environment

### `node:sqlite` is not available / the database engine check fails

Node.js 22.5 or newer is required. Check with `node --version`.

```
[fail] Node.js version: v20.11.0 is below the required 22.5.0.
```

Install a newer Node.js. There is no fallback: the bundled SQLite module is how
Sentinel Forge stores diagnostic history without a native build step.

### `ExperimentalWarning: SQLite is an experimental feature`

Expected. Node marks `node:sqlite` experimental. The CLI routes this specific
warning to the debug log; if you are seeing it, you are probably importing the
packages directly rather than going through the `sentinel` executable. See
[COMPATIBILITY.md](COMPATIBILITY.md).

### `Unknown command: <name>`

The CLI suggests the closest match:

```
Error: Unknown command: helth
Did you mean `sentinel health`? Run `sentinel help` for the full list.
```

Exit code `2`.

### `... is NOT IMPLEMENTED in this build (planned for GATE n)`

The command exists in the product specification but is not part of this build.
This is deliberate: an unimplemented command reports the fact rather than
returning an empty result. See [GATE_STATUS.md](GATE_STATUS.md). Exit code `2`.

## Configuration

### `Configuration is not valid`

Every problem is listed at once:

```
Error: Configuration is not valid (sentinel.config.json):
  - scan.maxDepth: scan.maxDepth must be an integer between 1 and 128.
  - logging.level: logging.level must be one of: DEBUG, INFO, WARN, ERROR, SILENT.
```

Fix the listed values. Exit code `2`.

### `Configuration file is not valid JSON`

`sentinel.config.json` is strict JSON: no comments, no trailing commas.

### `privacy.<x> cannot be enabled: the capability is NOT IMPLEMENTED`

Telemetry, network access and AI have no implementation in this build. The
switches are rejected rather than accepted and ignored, so the configuration
never claims something the product does not do.

### The wrong configuration file is being used

Discovery walks upward from the working directory. `sentinel doctor` prints the
file it loaded. Use `--config <path>` to be explicit.

Relative paths inside the configuration resolve against the **configuration
file's** directory, not the working directory.

## Scanning

### `Server path does not exist`

```bash
sentinel init --server "/opt/fxserver"          # Linux
sentinel init --server "C:\FXServer"            # Windows
```

Point it at the directory containing `server.cfg` and the resources directory,
not at `resources/` itself.

### `Rejected <path> that resolves outside the permitted root` (exit code 4)

A path — usually a manifest declaration or a symlink — resolved outside the
server directory. Sentinel Forge stops rather than reading it.

If it is a symlink you rely on, either scan the directory it points at directly,
or set `scan.followSymlinks: true` (which still refuses anything resolving
outside the root).

If you did not create that link, the resource containing it is worth reviewing
before it runs on a live server.

### `File exceeds the configured read limit`

The default cap is 4 MiB. Raise `scan.maxFileBytes`, or exclude the file. The
cap exists so that one enormous file cannot exhaust memory during a scan.

### Analysis looks incomplete

Traversal limits are reported rather than applied silently. A result may name a
depth limit, an entry limit, an unreadable directory or an unfollowed symlink.
Raise `scan.maxDepth` or `scan.maxFiles` if the limit is the cause.

## Database

### `Migration <file> has changed since it was applied to this database`

An applied migration was edited. Migrations are immutable once applied: add a
new one instead, or delete the local database (`.sentinel/sentinel.db`) and let
it be recreated. Deleting it discards local diagnostic history; it never touches
the FiveM server.

### `The local database was created by a newer version of Sentinel Forge`

The database file has a schema this build does not understand. Update Sentinel
Forge, or point `--database` at a different file.

### The database is locked

WAL mode allows readers alongside one writer. Two commands writing at once will
contend; there is a 5-second busy timeout. Run one writing command at a time.

## Output

### `--json` output will not parse

stdout carries results and stderr carries logs, so `sentinel ... --json` alone
should always be parseable. If you are capturing both streams into one, add
`--quiet`, or note that under `--json` log records are JSON too.

### A report contains something that looks like a credential

That is a defect. Report it as a **security issue** (see [SECURITY.md](../SECURITY.md)),
not a bug — and do not paste the value.

## Reporting a problem

Include:

- `sentinel version` output,
- the exact command,
- the error id (`SF-XXXXXXXX`) if one was printed,
- `--verbose` output if it is safe to share.

The error id contains no path and no credential; it correlates the message with
its log record.
