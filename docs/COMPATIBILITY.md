# Compatibility

© 2026 Talal Al Ghafri. All Rights Reserved.

This document records what has actually been tested. It does not claim
compatibility that has not been verified — a diagnostic tool that is wrong about
its own environment cannot be trusted about anything else.

Last updated: GATE 0.

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

**No FiveM runtime integration exists in this build.** GATE 0 delivers no
scanning and no runtime collector, so there is nothing to claim compatibility
for yet.

What GATE 1 and later will target:

| Surface | Planned support |
| --- | --- |
| `fxmanifest.lua` | Primary manifest format. |
| `__resource.lua` | Legacy manifest format. |
| `server.cfg` | Configuration parsing, `ensure`/`start` directives. |
| `resources/` layout | Configurable, including nested category directories. |

Every FiveM API used by the runtime collector (GATE 5) will be verified against
official Cfx.re documentation and tested before it is relied on. Where an API
does not exist or does not expose what is needed, the limitation is documented
and the closest safe alternative is implemented. Runtime data is never
synthesised.

## Server layouts

| Layout | Status |
| --- | --- |
| `resources/` at the server root | Planned, GATE 1. |
| Category directories (`resources/[core]/...`) | Planned, GATE 1. |
| Multiple resource roots | Configurable via `server.resourceDirectories`. |
| Symlinked resource directories | Not followed by default; opt-in via `scan.followSymlinks`. |

## Database

- SQLite through `node:sqlite`, local file, WAL mode for file databases.
- `STRICT` tables are used, which requires SQLite 3.37 or newer. Node 22 bundles
  a newer version.
- Concurrent access: WAL allows a reader alongside a writer, with a 5-second
  busy timeout. A second concurrent *writer* is not supported.

## Known limitations

1. No analysis capability exists in this build (GATE 0 is the foundation).
2. Windows and macOS are untested.
3. `node:sqlite` is experimental upstream.
4. Traversal does not follow symlinks by default; servers that rely on
   symlinked resource directories must opt in.
5. A file larger than `scan.maxFileBytes` (4 MiB by default) is refused rather
   than partially analysed, unless truncation is requested.
