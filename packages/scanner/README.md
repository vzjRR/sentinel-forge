# @sentinel-forge/scanner

**Status: NOT IMPLEMENTED.** Planned for GATE 1.

Server and resource discovery, `fxmanifest.lua` and `__resource.lua` parsing,
missing-file detection, and configuration checks.

Rules it will own: `CFG-MANIFEST-001`, `CFG-MISSING-FILE-001`.

Scanned Lua and JavaScript are analysed as text. Nothing found on disk is ever
executed.

This directory is a placeholder. It is deliberately **not** registered as a
workspace and produces no build output: an empty compiled package would be a
claim that something exists.

Will depend on `@sentinel-forge/core` for contained filesystem access and on
`@sentinel-forge/shared` for the finding and evidence contracts.

See [`docs/GATE_STATUS.md`](../../docs/GATE_STATUS.md) for delivery status and
[`ROADMAP.md`](../../ROADMAP.md) for the gate plan.
