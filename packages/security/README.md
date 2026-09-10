# @sentinel-forge/security

**Status: NOT IMPLEMENTED.** Planned for GATE 4.

Secret scanning, obfuscation indicators, remote-load detection, dynamic
execution detection, and suspicious file detection.

Rules it will own: `SEC-SECRET-001`, `SEC-WEBHOOK-001`, `SEC-OBFUSCATION-001`,
`SEC-REMOTE-LOAD-001`, `SEC-DYNAMIC-EXEC-001`, `SEC-SUSPICIOUS-FILE-001`.

Findings from this package are indicators, not proof of malicious behaviour.
Detected secrets are reported by location; the value is never stored.

This directory is a placeholder. It is deliberately **not** registered as a
workspace and produces no build output: an empty compiled package would be a
claim that something exists.

Redaction already exists in `@sentinel-forge/core`; this package reports where a
credential is, and relies on core to ensure the value never reaches output.

See [`docs/GATE_STATUS.md`](../../docs/GATE_STATUS.md) for delivery status and
[`ROADMAP.md`](../../ROADMAP.md) for the gate plan.
