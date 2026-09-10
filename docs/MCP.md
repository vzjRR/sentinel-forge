# MCP interface

© 2026 Talal Al Ghafri. All Rights Reserved.

**Status: NOT IMPLEMENTED.** Planned for GATE 7. This document records the
intended contract so the design is fixed before it is built, and so integrators
can see what it will and will not do.

## Purpose

An optional Model Context Protocol server exposing Sentinel Forge's findings to
an MCP client, so an assistant can read a diagnosis and help interpret it.

It is optional in the strict sense: the product is fully usable without it, and
no analysis depends on it.

## Read-only, by design

The MCP server **will not**:

- edit files,
- execute shell commands,
- start, stop or restart resources,
- delete resources or data,
- install software,
- modify server configuration,
- send anything to a remote service.

It reads what Sentinel Forge has already recorded locally and returns it. An
interface that both diagnoses a server and can change it is a tool that can
break a live server on a mistaken inference; the read-only boundary is the point
of the design, not a limitation of the first version.

## Planned tools

| Tool | Returns |
| --- | --- |
| `sentinel_scan` | Findings from a scan of the configured server. |
| `sentinel_health` | Server health score with its traceable deductions. |
| `sentinel_resource` | Health, findings, dependencies and history for one resource. |
| `sentinel_dependencies` | Dependency graph, unresolved dependencies, cycles. |
| `sentinel_performance` | Timing samples and baseline context. |
| `sentinel_compare` | Regression comparison between two baselines. |
| `sentinel_security` | Security indicators with evidence and the standing limitation text. |
| `sentinel_integrity` | Integrity snapshot comparison. |
| `sentinel_incidents` | Incident timelines with correlation confidence. |
| `sentinel_report` | A full report in the versioned schema. |

Every tool returns the same types as the report schema in [API.md](API.md).

## Handling of secrets

Secrets are redacted before they reach the database, so an MCP client
structurally cannot receive one. Findings carry a location, never a value.

## Relationship to Claude Code

Claude Code is a development tool used to build Sentinel Forge. It is not
required to run it, and the finished product works with no AI assistant present.

An optional developer workflow looks like:

```
FiveM server → Sentinel Forge → sentinel-report.json → an assistant → a human-reviewed explanation
```

The deterministic engine produces the diagnosis. An assistant may help explain
it. It never replaces detection.
