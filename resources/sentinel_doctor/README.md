# sentinel_doctor

**Status: NOT IMPLEMENTED.** Planned for GATE 5.

The in-server collector: a FiveM resource that gathers approved runtime
telemetry and exposes it to Sentinel Forge.

## Constraints, fixed before implementation

It will **not**:

- inject code into other resources,
- modify other resources,
- download or execute arbitrary code,
- modify server configuration,
- surveil players.

It will collect only what a diagnosis needs: resource state and restarts,
resource timing, server warnings, hitch indicators, player count as context,
join/leave counts, and relevant server events.

## Verification requirement

Every FiveM API used here must first be verified against official Cfx.re
documentation and tested against a real server. Where an API does not exist or
does not expose what is needed, the limitation is documented and the closest
safe alternative is implemented.

**Runtime data is never invented.** If a value cannot be collected, it is
reported as unavailable.

## Overhead

Collection is event-driven, batched and cached. Overhead is benchmarked before
every release, and significant overhead is a release blocker rather than a known
issue.

See [`docs/GATE_STATUS.md`](../../docs/GATE_STATUS.md).
