# Security

© 2026 Talal Al Ghafri. All Rights Reserved.

Sentinel Forge is pointed at content its operator did not write and cannot fully
trust: resources downloaded from marketplaces, forums and third parties. This
document states what the product guarantees, what it does not, and how to report
a vulnerability.

## 1. Guarantees

These hold in every build and are enforced by tests in `tests/security/`.

| Guarantee | How it is enforced |
| --- | --- |
| Scanned code is never executed. | Analysis is textual and structural. `tests/security/repository-hygiene.test.ts` fails the build if `eval`, `new Function`, or `child_process` appears in product source. |
| Nothing is read outside the scanned root. | Every path is resolved against a root with symlinks followed and containment verified (`core/fs/paths.ts`). Verified by `tests/security/path-traversal.test.ts`. |
| The server is never modified. | No product code writes to the scanned server. Sentinel Forge writes only to its own working directory. |
| No outbound network access. | The product uses no network API. Enforced by a source-level test. |
| Secrets are never stored or reported in readable form. | Redaction is applied to log records, error messages and evidence excerpts. Verified by `tests/security/redaction.test.ts`. |
| Analysis cannot exhaust the host. | Reads are size-bounded and restricted to regular files; traversal is bounded by depth, entry count and cycle detection. |
| Telemetry is off. | There is no telemetry code. The configuration switch exists and is rejected if enabled. |

## 2. Limitations

Stated plainly, because a security tool that overstates itself is worse than
none:

- **Findings are indicators, not proof.** Security findings identify patterns
  worth reviewing. They do not establish that code is malicious, that a
  vulnerability is exploitable, or that a server has been compromised.
- **The absence of a finding is not evidence of safety.** Sentinel Forge is not
  an antivirus, not an anti-cheat, and not a malware detector.
- **Obfuscation is not malice.** Obfuscation indicators mean the code cannot be
  reviewed normally. Commercial resources are frequently obfuscated for licence
  protection.
- **Only what is supplied is analysed.** Code fetched at runtime from a remote
  source is outside the scope of a static scan by definition.
- **Static analysis cannot follow every path.** A loop that yields through a
  helper the analyzer cannot resolve may be reported; this is why every rule
  documents its known false positives.

## 3. Threat model

**Trusted:** the operator running the CLI, the machine it runs on, the Node.js
runtime.

**Untrusted:** everything inside the scanned server — file contents, file names,
manifest declarations, configuration values, and supplied logs.

Threats considered:

| Threat | Mitigation |
| --- | --- |
| A manifest declares `../../../etc/passwd`. | Path containment; the read is refused with exit code 4. |
| A resource directory contains a symlink to `/`. | Real-path resolution; symlinks are not followed during traversal by default. |
| A resource contains a 6 GB file or a FIFO. | Size-bounded reads; regular files only. |
| A directory tree contains a symlink cycle. | Traversal deduplicates by real path and is depth-bounded. |
| A resource contains hostile file names (`-rf`, NUL bytes, control characters). | Paths are handled as data, never interpolated into a shell — there is no shell execution anywhere in the product. |
| A scanned file contains a live credential. | Redaction before persistence and rendering; findings report a location, not a value. |
| A malicious resource tries to get its code run by the scanner. | Nothing scanned is ever executed or imported. |
| A resource name or a Lua excerpt is markup, aimed at the operator's browser through the dashboard or an HTML report. | Every value passes through one escaping module before it becomes markup; no page emits script, and the content security policy is `default-src 'none'`. |
| A page on another origin points a DNS name at `127.0.0.1` to read the dashboard from the operator's browser. | The `Host` header is checked on every request before routing; an unexpected name is refused with `421`. |
| A request tries to make the dashboard read a file (`/../../etc/passwd`). | There is no static directory and no route that maps a URL onto a filesystem path. Traversal sequences are refused rather than normalised. |
| A page or endpoint prints a credential out of `server.cfg`. | Configuration values are withheld by key name *and* by the credential detector, on the page and in the JSON API alike. |

Out of scope: an operator who deliberately runs Sentinel Forge as a privileged
user against a hostile filesystem they do not control, and any threat that
requires an attacker to already have code execution on the operator's machine.

## 4. Secure defaults

```jsonc
{
  "scan":    { "followSymlinks": false },
  "privacy": { "telemetry": false, "network": false, "ai": false }
}
```

- The local database lives in the working directory, not a shared location.
- No automatic fixes, no automatic downloads, no automatic server modification.
- The dashboard binds `127.0.0.1`. Binding an address reachable from the
  network requires `--allow-non-loopback`; without it the command exits `4`.
- The in-server collector is opt-in: it is a resource the operator installs
  themselves, it writes only inside its own directory, and it makes no network
  request.

### The dashboard's posture

It has **no authentication**. Anyone who can reach the port can read everything
it shows, which is why it is loopback-only by default.

| Control | Enforced in |
| --- | --- |
| Loopback by default; other addresses refused without an explicit opt-in | `apps/dashboard/src/server.ts` |
| `GET` and `HEAD` only — `405` before routing | Same |
| `Host` header checked — `421` on an unexpected name | Same |
| `Content-Security-Policy: default-src 'none'`, `nosniff`, `DENY`, `no-referrer`, `no-store`, and no CORS header | Same |
| Fixed route table; no file served from disk | `apps/dashboard/src/routes.ts` |
| Configuration values withheld by key name and by detector | `apps/dashboard/src/redact.ts` |
| No script emitted on any page | `apps/dashboard/src/views/layout.ts` |

`tests/security/dashboard-exposure.test.ts` asserts all of it against a real
server, over a real socket, with fabricated credentials and a resource whose
name and manifest description are script payloads.

### The MCP interface's posture

Its consumer is a language model, so whatever it returns may be copied into a
conversation, a transcript, and a model provider's logs.

| Control | Enforced in |
| --- | --- |
| Every tool read-only, non-destructive, closed-world — all stated explicitly, because the specification's defaults are the opposite | `apps/mcp/src/tools.ts` |
| No tool that writes, executes, reaches the network, or persists anything | Asserted against the registry and the source by `tests/security/mcp-exposure.test.ts` |
| Results redacted again on the way out | `apps/mcp/src/tools.ts` |
| stdout reserved for protocol messages; `--json` refused | `apps/cli/src/commands/mcp.ts` |
| Reading never records: `sentinel_compare` returns incidents without persisting them | `apps/mcp/src/tools.ts`, asserted by the security suite |

## 5. Handling of secrets

When a credential-shaped value is detected, Sentinel Forge records **where** it
is, never **what** it is.

```
Detected: Discord webhook endpoint
Location: resources/sf_suspicious/server.lua:4
Value:    https://discord.com/api/webhooks/********
```

The raw value is not written to the database, to any report, or to any log. The
`security_findings` table names its excerpt column `redacted_excerpt` so the
storage contract is visible at schema level, and a test enforces that naming for
every excerpt column in every migration.

If you find a credential in a report, that is a defect: report it as a
vulnerability rather than a bug.

### No credential-shaped value is committed, including in tests

Testing a credential detector requires realistic input, but a repository
containing strings that a secret scanner reads as live is its own problem: it
trips push protection, alarms reviewers, and contradicts the commitment above.

Such values are therefore assembled from fragments at runtime
(`tests/helpers/fabricated-credentials.ts`) and never written into a file.
`tests/security/repository-hygiene.test.ts` enforces the rule against the whole
source tree.

## 6. Privacy

Sentinel Forge is local-first.

| Question | Answer |
| --- | --- |
| What is collected? | Only what a command reads from the server path it is given. |
| Where is it stored? | `.sentinel/` in the working directory, by default. |
| What leaves the machine? | Nothing. The product makes no outbound requests. |
| How is it deleted? | Delete `.sentinel/`. `sentinel purge` (GATE 3) will do this selectively, with configurable retention. |
| Is there player surveillance? | No. Player-count context is recorded only where a runtime collector provides it, and no per-player data is retained. |

## 7. Reporting a vulnerability

Report privately to the owner, Talal Al Ghafri. Please do not open a public
issue for a security defect.

Include: what you observed, the steps to reproduce it, the affected version
(`sentinel version`), and the impact you believe it has. A reproduction against
a synthetic fixture is ideal. **Do not include real credentials** — if a
credential was disclosed, say so and rotate it; do not paste it.

## 8. Release checklist

Verified before every release:

- [ ] No secrets committed (`tests/security/repository-hygiene.test.ts`)
- [ ] No raw credentials in reports (`tests/security/redaction.test.ts`)
- [ ] Path traversal tests pass
- [ ] Symlink escape tests pass
- [ ] Report redaction tests pass
- [ ] No arbitrary shell execution
- [ ] No arbitrary Lua execution
- [ ] No arbitrary downloads
- [ ] Dashboard local-only by default
- [ ] Telemetry disabled by default
- [ ] Security claims accurately worded
- [ ] No production data in the repository
