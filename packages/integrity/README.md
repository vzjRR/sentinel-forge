# @sentinel-forge/integrity

**Status: NOT IMPLEMENTED.** Planned for GATE 4.

File integrity snapshots and comparison: added, deleted, modified and
hash-changed files between two points in time.

Rules it will own: `INT-CHANGE-001`.

Files are never quarantined, moved or deleted. Integrity tracking reports; it
does not act.

This directory is a placeholder. It is deliberately **not** registered as a
workspace and produces no build output: an empty compiled package would be a
claim that something exists.

Streaming SHA-256 hashing and the `integrity_snapshots` and `integrity_entries`
tables already exist.

See [`docs/GATE_STATUS.md`](../../docs/GATE_STATUS.md) for delivery status and
[`ROADMAP.md`](../../ROADMAP.md) for the gate plan.
