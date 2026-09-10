# @sentinel-forge/runtime

**Status: NOT IMPLEMENTED.** Planned for GATE 5.

Ingestion and normalisation of telemetry collected by the in-server
`sentinel_doctor` resource.

No FiveM API will be used until it has been verified against official Cfx.re
documentation and tested. Where an API is unavailable, the limitation is
documented and the closest safe alternative is implemented. Runtime data is
never synthesised.

This directory is a placeholder. It is deliberately **not** registered as a
workspace and produces no build output: an empty compiled package would be a
claim that something exists.

Will write into `performance_samples` with an explicit `source`, so the
provenance of every sample stays auditable.

See [`docs/GATE_STATUS.md`](../../docs/GATE_STATUS.md) for delivery status and
[`ROADMAP.md`](../../ROADMAP.md) for the gate plan.
