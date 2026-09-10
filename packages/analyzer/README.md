# @sentinel-forge/analyzer

**Status: NOT IMPLEMENTED.** Planned for GATE 2.

Lua static analysis, event graph analysis, database query analysis, and the
explainable health scoring engine.

Rules it will own: `PERF-LOOP-001`, `PERF-EVENT-001`, `PERF-QUERY-001`.

`Wait(0)` is a legitimate per-frame pattern and is not by itself a defect; the
`performance-smell` fixture includes it as a false-positive control.

This directory is a placeholder. It is deliberately **not** registered as a
workspace and produces no build output: an empty compiled package would be a
claim that something exists.

Will implement the `HealthScore` contract from `@sentinel-forge/shared`, where
every deduction names the finding that caused it.

See [`docs/GATE_STATUS.md`](../../docs/GATE_STATUS.md) for delivery status and
[`ROADMAP.md`](../../ROADMAP.md) for the gate plan.
