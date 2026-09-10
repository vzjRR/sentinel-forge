# @sentinel-forge/reports

**Status: NOT IMPLEMENTED.** Planned for GATE 1.

Rendering of the versioned report envelope as JSON, Markdown and HTML.

Secrets are already redacted before they reach this package; the renderer must
never re-introduce a raw value, and every report must carry its limitations
section.

This directory is a placeholder. It is deliberately **not** registered as a
workspace and produces no build output: an empty compiled package would be a
claim that something exists.

The schema and its structural validator already exist in
`@sentinel-forge/shared/report`.

See [`docs/GATE_STATUS.md`](../../docs/GATE_STATUS.md) for delivery status and
[`ROADMAP.md`](../../ROADMAP.md) for the gate plan.
