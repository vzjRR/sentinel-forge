# Sentinel Forge dashboard

**Status: NOT IMPLEMENTED.** Planned for GATE 6.

A local-first web dashboard over the same data the CLI reports: server overview,
resources and resource detail, performance, incidents, security, dependencies,
integrity, reports and settings.

Design commitments fixed in advance:

- Binds to `127.0.0.1`. Not exposed publicly by default.
- Read-only. No command execution, no server modification from the browser.
- High information density: technical tables, readable graphs, timelines and
  evidence panels. It should read as an engineering tool, not a marketing page.
- No fabricated values. Where data was not collected, the interface says
  `Unavailable` or `Not collected`.

This directory is a placeholder and is not registered as a workspace.

See [`docs/GATE_STATUS.md`](../../docs/GATE_STATUS.md).
