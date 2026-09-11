# MCP interface

© 2026 Talal Al Ghafri. All Rights Reserved.

An optional Model Context Protocol server exposing Sentinel Forge's findings to
an MCP client, so an assistant can read a diagnosis and help interpret it.

It is optional in the strict sense: the product is fully usable without it, and
no analysis depends on it. **Sentinel Forge works with no AI assistant present.**

## Running it

```bash
sentinel mcp --server /path/to/fxserver
```

It speaks the protocol over stdio and runs until the client closes its input.
An MCP client launches it as a subprocess:

```jsonc
{
  "mcpServers": {
    "sentinel-forge": {
      "command": "sentinel",
      "args": ["mcp", "--server", "/opt/fxserver"]
    }
  }
}
```

`--refresh <seconds>` controls how long a scan stays current (default 300).
`--json` is refused: the stdio transport reserves stdout for protocol messages,
and a result written there would corrupt the session. Logs go to stderr, which
the transport explicitly permits.

## Read-only, by design

The MCP server **cannot**:

- edit files,
- execute shell commands,
- start, stop or restart resources,
- delete resources or data,
- install software,
- modify server configuration,
- send anything to a remote service.

It reads what Sentinel Forge has already analysed and recorded locally, and
returns it. An interface that both diagnoses a server and can change it is a
tool that can break a live server on a mistaken inference; the read-only
boundary is the point of the design, not a limitation of the first version.

Every tool declares `readOnlyHint: true`, `destructiveHint: false`,
`idempotentHint: true` and `openWorldHint: false`. All four are stated
explicitly because the specification's defaults are the opposite of the truth
here — `destructiveHint` and `openWorldHint` both default to `true`, and a
read-only server that lets them stand is describing itself as a destructive one.

`tests/security/mcp-exposure.test.ts` asserts the boundary against the registry
rather than against behaviour, so it holds for a tool added later by someone who
has not read this page.

## Tools

| Tool | Returns |
| --- | --- |
| `sentinel_scan` | Findings from a scan of the configured server, with evidence. Filterable by severity, category and resource. |
| `sentinel_health` | Health score with every deduction that produced it, any cap applied, and the categories that could not be scored with the reason for each. |
| `sentinel_resource` | One resource: declared metadata, health, findings, dependencies both ways, and the scripts analysed. |
| `sentinel_dependencies` | Dependency graph, unresolved edges, cycles. |
| `sentinel_performance` | What the collector measured, the baselines recorded, and static performance findings — kept apart. |
| `sentinel_compare` | What changed between two baselines, with incidents. Does not record them. |
| `sentinel_security` | Security indicators with evidence and the standing limitation text. |
| `sentinel_integrity` | Integrity snapshots, and the comparison between two of them. |
| `sentinel_incidents` | Incident timelines with correlation confidence, and observed runtime events. |
| `sentinel_report` | The full report in the versioned schema. |

Every tool returns the same types as the report schema in [API.md](API.md).

## What every result carries

**`limitations`.** An array, on every result, never empty. An assistant that
receives a finding without the sentence saying what it does not establish will
present it as proven, so the limitations are part of the payload rather than
documentation about the payload.

The server also sends `instructions` at initialization, stating three rules a
client should carry into any explanation it gives:

1. Findings are observations, not proofs. Security findings are indicators
   requiring human verification, and the absence of a finding is never evidence
   that a server is safe.
2. An absent value means it was not collected, not that nothing was found.
3. Correlation is not causation. Incident confidence is capped at 0.85 for
   exactly that reason.

## Handling of secrets

Secrets are redacted before they reach the database, so an MCP client
structurally cannot receive one. Findings carry a location, never a value.

Results are redacted again on the way out. That is belt and braces — nothing
should reach that point unredacted — but this is the surface where a leak would
be copied into a conversation, a transcript, and a model provider's logs, so it
is worth paying for twice.

## Protocol

Implemented directly against the published specification, with no SDK: Sentinel
Forge takes no third-party runtime dependency, and a product whose pitch is that
it does not run other people's code should not add a supply chain to read its
own findings.

| | |
| --- | --- |
| Protocol version | `2025-06-18`, with `2025-03-26` and `2024-11-05` accepted |
| Transport | stdio — newline-delimited JSON-RPC 2.0, UTF-8 |
| Capabilities declared | `tools` only |
| Methods | `initialize`, `ping`, `tools/list`, `tools/call` |

Sources checked before implementing, and cited in the source:

- <https://modelcontextprotocol.io/specification/2025-06-18/basic/transports>
- <https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle>
- <https://modelcontextprotocol.io/specification/2025-06-18/server/tools>
- `modelcontextprotocol/modelcontextprotocol` → `schema/2025-06-18/schema.ts`

Version negotiation follows the specification: the client's version is echoed
when this server supports it, and the latest supported version is returned
otherwise.

## Limitations

1. **No prompts, no resources, no sampling, no logging channel.** Each would be
   another surface, and none is needed to read a diagnosis.
2. **No pagination.** `tools/list` returns all ten tools in one response.
   `sentinel_scan` and `sentinel_security` bound their output with `limit` and
   say how many findings were not returned.
3. **One server per process.** The server serves the server its configuration
   points at.
4. **`sentinel_compare` builds incidents without recording them.** A tool call
   is not a decision to write to the operator's history; `sentinel compare`
   records them.
5. **Scans are cached.** A tool result states when its scan was taken. Two calls
   inside the refresh window are answered from one scan.

## Relationship to Claude Code

Claude Code is a development tool used to build Sentinel Forge. It is not
required to run it, and the finished product works with no AI assistant present.

An optional workflow looks like:

```
FiveM server → Sentinel Forge → findings → an assistant → a human-reviewed explanation
```

The deterministic engine produces the diagnosis. An assistant may help explain
it. It never replaces detection.
