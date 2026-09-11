# Compatibility

© 2026 Talal Al Ghafri. All Rights Reserved.

This document records what has actually been tested. It does not claim
compatibility that has not been verified — a diagnostic tool that is wrong about
its own environment cannot be trusted about anything else.

Last updated: GATE 1.

## Node.js

| Version | Status | Notes |
| --- | --- | --- |
| 22.22.2 | **Verified** | Full build, lint, typecheck and test suite pass. |
| 22.5 – 22.21 | **Expected to work, untested** | 22.5 is the first release with `node:sqlite`. |
| < 22.5 | **Unsupported** | `node:sqlite` is unavailable. `sentinel doctor` fails this check explicitly. |
| 24.x, 26.x | **Untested** | No known blocker; not yet verified. |

### `node:sqlite` is experimental

Node marks `node:sqlite` experimental and emits an `ExperimentalWarning` on
first use.

- The API is stable enough for this product's use, which is limited to
  `DatabaseSync`, `prepare`, `exec` and standard SQL.
- The CLI routes that specific warning to the debug log instead of the terminal;
  all other warnings are still shown.
- The database sits behind `DatabaseDriver`, so replacing the engine would not
  affect anything above it.

SQLite version observed on the verified platform: 3.51.2 (bundled with Node).

## Operating systems

| OS | Status | Notes |
| --- | --- | --- |
| Linux (x64) | **Verified** | Primary development and CI platform. |
| Windows | **Untested** | Path handling is written for it: case-insensitive comparison, `path.sep` throughout, POSIX paths in output. Not yet verified on a Windows host. |
| macOS | **Untested** | Case-insensitive comparison is handled the same way as Windows. |

Path handling is platform-aware by construction, but "written for it" is not
"tested on it", and this table will not say otherwise until it has been.

## FiveM

Static analysis reads a server directory. Runtime data comes from one optional
server-side resource, `sentinel_doctor`, which the operator installs
themselves — the CLI itself still calls no FiveM API and makes no connection to
a server.

The manifest and configuration behaviour below was verified against official
Cfx.re documentation and the official server data repository. Facts taken from
those sources are cited; nothing in this table is inferred.

| Surface | Support | Source |
| --- | --- | --- |
| `fxmanifest.lua` | Parsed. Lua, semi-declarative, never executed. | [Resource manifest](https://docs.fivem.net/docs/scripting-reference/resource-manifest/) |
| `__resource.lua` | Parsed. Reported at INFO as the legacy format. | Same |
| `fx_version` values | `cerulean`, `bodacious`, `adamant` recognised. An unknown value is reported at LOW severity and 0.5 confidence, because a newer version may exist than this build knows about. | Same |
| `game` / `games` | Both spellings. `gta5`, `rdr3`, `common` recognised. | Same |
| `client_script(s)`, `server_script(s)`, `shared_script(s)` | Parsed, globs resolved. | Same |
| `file` / `files`, `ui_page` | Parsed, globs resolved. | Same |
| `dependency` / `dependencies` | Parsed. Entries beginning with `/` (`/server:5104`, `/onesync`, `/gameBuild:h4`, `/policy:…`) are runtime constraints, not resources, and are excluded from the graph. | Same |
| `provide` | Parsed. A provided name satisfies other resources' dependencies on it. | Same |
| `data_file` | Parsed as `data_file 'TYPE' 'path'`. | Same |
| Globs | `*` non-recursive, `**` and `**/` recursive, `**/prefix_*.ext` supported. | Same |
| `server.cfg` | Parsed: `ensure`, `start`, `stop`, `restart`, `set`/`sets`/`setr`, `exec`. | [Server commands](https://docs.fivem.net/docs/server-manual/server-commands/) |
| Category targets | `ensure [managers]` and similar affect every resource in a category and are never reported as a missing resource. | Same |
| `[category]` directories | Resources nested one level inside a bracketed directory are discovered. | [cfx-server-data](https://github.com/citizenfx/cfx-server-data) |
| Bundled resources | `baseevents`, `runcode`, `mapmanager`, `spawnmanager`, `player-data`, `playernames`, `chat-theme-example`, `basic-gamemode`, `example-loadscreen` are treated as platform-provided. | Same |

### Not yet supported

| Surface | Status |
| --- | --- |
| `exec`-ed configuration files | Parsed as a directive, but the referenced file is not followed. Resources started only by a nested config are not yet seen. |
| Runtime constraint evaluation | Constraints are listed, not checked against a server build. |
| `escrow_ignore` and vendor-specific directives | Recorded as unknown directives at INFO; not interpreted. |
| Conditional logic in a manifest | Not evaluated. A manifest that computes a path at load time yields no path to check, and the declaration is skipped rather than guessed at. |

## Server layouts

| Layout | Status |
| --- | --- |
| `resources/` at the server root | Planned, GATE 1. |
| Category directories (`resources/[core]/...`) | Planned, GATE 1. |
| Multiple resource roots | Configurable via `server.resourceDirectories`. |
| Symlinked resource directories | Not followed by default; opt-in via `scan.followSymlinks`. |

## FiveM runtime API

Every native and event the `sentinel_doctor` collector uses was verified against
the official declarations in
[`citizenfx/fivem`](https://github.com/citizenfx/fivem/tree/master/ext/native-decls)
and [docs.fivem.net](https://docs.fivem.net/) before it was used. Nothing is
called speculatively.

| API | Used for | Availability |
| --- | --- | --- |
| `GetGameTimer` | Monotonic milliseconds | Shared native |
| `GetNumResources`, `GetResourceByFindIndex`, `GetResourceState` | Resource state sweep | Shared natives |
| `onResourceStart`, `onResourceStop` | State transitions | Server events |
| `GetNumPlayerIndices` | Player count only | Server native |
| `GetConvar`, `GetConvarInt` | Configuration | Server natives |
| `SaveResourceFile`, `GetCurrentResourceName`, `GetResourceMetadata` | Writing telemetry into its own resource | Server natives |

### Not available, and therefore not reported

| Wanted | Status |
| --- | --- |
| Per-resource CPU or tick time | **No scripting API exists.** The official profiler (`profiler record`, `profiler saveJSON`) is a console command that writes a file; it cannot be driven from a script, and no native exposes another resource's timing. Sentinel Forge reports none rather than estimating. |
| Runtime errors raised inside another resource | **No scripting API exists.** This is why the `RELIABILITY` health category is unscored. |
| Memory use per resource | **No scripting API exists** on the server for another resource's memory. |

If Cfx.re adds an API for any of these, the collector gains it and the
limitation is removed from this table. Until then the gap is stated, not filled.

## Database

- SQLite through `node:sqlite`, local file, WAL mode for file databases.
- `STRICT` tables are used, which requires SQLite 3.37 or newer. Node 22 bundles
  a newer version.
- Concurrent access: WAL allows a reader alongside a writer, with a 5-second
  busy timeout. A second concurrent *writer* is not supported.

## Known limitations

1. Runtime data requires the operator to install `sentinel_doctor`. Without it,
   analysis is static only, and every report says so rather than implying that
   nothing was wrong.
2. Windows and macOS are untested.
3. `node:sqlite` is experimental upstream.
4. Traversal does not follow symlinks by default; servers that rely on
   symlinked resource directories must opt in.
5. A file larger than `scan.maxFileBytes` (4 MiB by default) is refused rather
   than partially analysed, unless truncation is requested.
