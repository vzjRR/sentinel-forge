# @sentinel-forge/performance

**Status: NOT IMPLEMENTED.** Planned for GATE 3.

Baseline creation and storage, sample storage, baseline comparison, regression
detection, and the correlation and incident engines.

Rules it will own: `PERF-REGRESSION-001`.

Regression detection combines absolute and relative thresholds with sample
counts and variance: a large percentage change on a tiny absolute value is not a
regression. Temporal correlation never implies causation.

This directory is a placeholder. It is deliberately **not** registered as a
workspace and produces no build output: an empty compiled package would be a
claim that something exists.

Will read and write the `baselines`, `performance_samples`, `incidents` and
`incident_events` tables, which already exist in schema version 1.

See [`docs/GATE_STATUS.md`](../../docs/GATE_STATUS.md) for delivery status and
[`ROADMAP.md`](../../ROADMAP.md) for the gate plan.
