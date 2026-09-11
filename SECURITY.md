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
- The dashboard (GATE 6) will bind to `127.0.0.1` and will not be exposed by
  default.

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
