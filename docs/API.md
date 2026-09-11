# API and data contracts

© 2026 Talal Al Ghafri. All Rights Reserved.

This document specifies the contracts a consumer can build against: the finding
model, the report schema, severity and confidence, and the local HTTP API
planned for the dashboard.

## Stability

| Contract | Stability |
| --- | --- |
| Rule ids | Stable. A rule's meaning never changes silently; a changed meaning gets a new id. |
| Report `schemaVersion` | Stable within a major version, versioned independently of the product. |
| Severity values | Stable. |
| Confidence range and bands | Stable. |
| Exit codes | Stable within a major version. |
| Database schema | Internal. Access it through the CLI or report output, not directly. |

## Finding

```ts
interface Finding {
  id: string;              // deterministic: identical input yields an identical id
  ruleId: string;          // e.g. "DEP-MISSING-001"
  category: 'PERFORMANCE' | 'DEPENDENCIES' | 'SECURITY'
          | 'INTEGRITY' | 'CONFIGURATION' | 'ERRORS';
  severity: 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  confidence: number;      // 0.00–1.00, two decimals
  title: string;
  summary: string;
  recommendation: string;
  evidence: Evidence[];    // non-empty for any severity above INFO
  resource?: string;
  file?: string;           // server-relative POSIX path, never an absolute host path
  line?: number;           // 1-based
  timestamp: string;       // ISO-8601
  metadata?: Record<string, string | number | boolean>;
}
```

Findings are ordered deterministically: severity descending, then confidence
descending, then `ruleId`, `resource`, `file`, `line` ascending. Two runs over
identical input produce byte-identical ordering.

### Severity

| Value | Meaning |
| --- | --- |
| `CRITICAL` | Severe impact; act before the next restart. |
| `HIGH` | Significant impact on stability, performance or exposure. |
| `MEDIUM` | Real impact, not urgent. |
| `LOW` | Minor. |
| `INFO` | Observation with no implied defect. |

### Confidence

| Range | Band |
| --- | --- |
| 0.90–1.00 | Very high |
| 0.75–0.89 | High |
| 0.50–0.74 | Moderate |
| 0.25–0.49 | Low |
| 0.00–0.24 | Very low |

Severity and confidence are independent. A `CRITICAL` finding at confidence 0.30
is a serious possibility that needs checking; a `LOW` finding at 1.00 is a
certainty that barely matters.

### Evidence

```ts
interface Evidence {
  kind: 'FILE_REFERENCE' | 'CODE_PATTERN' | 'CONFIG_VALUE' | 'RELATIONSHIP'
      | 'MEASUREMENT' | 'FILE_HASH' | 'LOG_ENTRY' | 'RUNTIME_EVENT';
  description: string;
  location?: { file: string; line?: number; column?: number; endLine?: number };
  excerpt?: string;        // always redacted
  measurement?: { value: number; unit: string; sampleCount?: number; baselineValue?: number };
  observedAt?: string;
  metadata?: Record<string, string | number | boolean>;
}
```

Evidence describes observations. It never asserts causation.

## Report envelope

`schemaVersion: "1.2"`.

Schema history:

| Version | Change |
| --- | --- |
| 1.2 | Added the optional `performance.runtime` object, describing what the in-server collector measured. Absent when no collector is installed — which is the same thing it means: nothing was measured. |
| 1.1 | Added the optional `events` section and the optional per-resource `health` object. Additive: a 1.0 consumer sees the fields it already knows, unchanged. |
| 1.0 | Initial schema. |

```jsonc
{
  "schemaVersion": "1.0",
  "generatedAt": "2026-01-01T00:00:00.000Z",
  "metadata": {
    "generatedAt": "...", "productVersion": "0.1.0", "command": "scan",
    "durationMs": 1240, "hostPlatform": "linux-x64", "nodeVersion": "v22.22.2"
  },
  "server": {
    "id": "srv_...", "path": "/opt/fxserver", "configPath": "server.cfg",
    "resourceRoots": ["resources"], "resourceCount": 42,
    "fingerprint": "sha256...", "scannedAt": "..."
  },
  "health": { /* optional; absent when not scored */ },
  "resources": [ { "resource": { ... }, "health": { ... }, "findingIds": [ ... ] } ],
  "findings": [ /* Finding[] */ ],
  "dependencies": { "edges": [], "unresolved": [], "cycles": [] },
  "performance":  {
    "collected": true, "sampleCount": 1440, "regressions": [],
    // Present only when the sentinel_doctor collector is installed.
    "runtime": {
      "collectorInstalled": true, "documentCount": 12,
      "sampleCount": 1440, "eventCount": 38,
      "metrics": ["scheduler_latency_ms"], "resourcesObserved": ["sf_core"],
      "earliest": "...", "latest": "...",
      "dropped": { "samples": 0, "events": 0 },
      "unreadable": [], "limitation": "..."
    }
  },
  "security":     { "findingIds": [], "bySeverity": {}, "limitation": "..." },
  "integrity":    { "added": [], "modified": [], "deleted": [] },
  "incidents": [],
  "limitations": [ "..." ]
}
```

Two rules govern reading a report:

1. **An absent section means "not collected", not "nothing found".** A consumer
   must distinguish the two; that is why sections are omitted rather than
   emitted empty.
2. **`limitations` is always populated.** It states what the report does not
   establish. Rendering a report without it misrepresents the analysis.
3. **`performance.collected` is not `performance.runtime !== undefined`.** A
   collector can be installed and have measured nothing yet; `runtime` is then
   present with `sampleCount: 0` and `collected` is `false`. "Installed" and
   "measuring" are different states, and conflating them would let an empty
   report read as a healthy one.
4. **No field anywhere carries per-resource timing.** FiveM exposes no scripting
   API for it. A consumer looking for one will not find it, and must not
   synthesise it from `scheduler_latency_ms`, which is attributed to `(server)`
   precisely because it cannot be attributed to a resource.

### Health score

```ts
interface HealthScore {
  score: number;                    // 0–100
  categories: { category: string; score: number; deductions: HealthDeduction[] }[];
  primaryReasons: string[];
  cap?: { appliedScore: number; reason: string; ruleId: string };
  complete: boolean;                // false when a category could not be scored
  unavailable?: Record<string, string>;
}
```

Every deduction names the finding that caused it. A score with no traceable
deductions is a defect, not a summary. When data is missing, `complete` is
`false` and `unavailable` says why — a category is never given a default value.

#### How the score is computed

1. **Each finding becomes a deduction.** Points by severity, at full confidence:

   | Severity | Points |
   | --- | --- |
   | CRITICAL | 45 |
   | HIGH | 25 |
   | MEDIUM | 10 |
   | LOW | 4 |
   | INFO | 0 |

   INFO deducts nothing: it is an observation, not a defect. A server does not
   lose points for using the legacy manifest format, or for depending on a
   resource that ships with the platform.

2. **Points are weighted by confidence.** `points = round(severityPoints × confidence)`.
   A finding the evidence half-supports moves the score half as far.

3. **Each category scores `100 − sum(deductions)`,** floored at 0. The
   deductions in a category always sum to its score.

4. **The overall score is a weighted mean of the categories that were scored.**

   | Category | Weight |
   | --- | --- |
   | Performance | 25 |
   | Security | 25 |
   | Reliability | 15 |
   | Dependencies | 15 |
   | Configuration | 10 |
   | Integrity | 10 |

   Weights are normalized across the categories actually scored, so an
   unavailable category does not silently pull the average up or down.

5. **Caps apply last**, because some findings make a high score misleading
   regardless of the average:

   | Condition | Ceiling |
   | --- | --- |
   | A CRITICAL finding at confidence ≥ 0.50 | 40 |
   | A HIGH finding at confidence ≥ 0.75 | 75 |

   A cap is always reported alongside the score, with the finding that triggered
   it, and appears first in `primaryReasons`.

Rule categories map onto health categories one to one: `PERFORMANCE`,
`SECURITY`, `DEPENDENCIES`, `INTEGRITY` and `CONFIGURATION` keep their names,
and `ERRORS` maps to `RELIABILITY`.

### Event section

```ts
interface EventReportSection {
  eventCount: number;
  networkEventCount: number;
  broadcastEventCount: number;
  triggeredButNotRegistered: string[];  // triggered somewhere, handled nowhere
  registeredButNotTriggered: string[];  // handled somewhere, never triggered
  dynamicUsageCount: number;            // event name computed at runtime
  events: { event: string; network: boolean; broadcast: boolean;
            registeredBy: string[]; triggeredBy: string[] }[];
}
```

Reported as data, not as findings: an event registered in one resource and
triggered from another is normal architecture. `dynamicUsageCount` counts
usages whose event name could not be read statically — those are excluded from
the graph rather than guessed at.

## Rule catalog

```bash
sentinel help rules --json
```

Each entry carries `id`, `category`, `defaultSeverity`, `title`, `rationale`,
`falsePositives`, `status` and `targetGate`. `status` states honestly whether the
rule executes in the current build.

## Local HTTP API

Served by `sentinel dashboard`, bound to `127.0.0.1`, read-only.

```
GET /api/health
GET /api/server
GET /api/resources
GET /api/resources/:name
GET /api/dependencies
GET /api/performance
GET /api/security
GET /api/integrity
GET /api/incidents
GET /api/reports
GET /api/settings
```

Every endpoint serves the same types as the report schema, so a consumer reading
`/api/resources` and a consumer reading a JSON report are reading the same
shapes.

Rules that apply to every endpoint:

1. **GET and HEAD only.** Anything else is refused with `405` before routing.
   There is no state to change: the dashboard cannot modify the FiveM server,
   run a command against it, or alter configuration.
2. **No authentication, and therefore loopback only.** Binding elsewhere
   requires `--allow-non-loopback` and is refused otherwise. The `Host` header
   is checked on every request, so a page on another origin cannot point a DNS
   name at `127.0.0.1` and read these endpoints.
3. **No CORS header is sent.** No other origin can read a response.
4. **Configuration values are withheld.** `/api/server` returns the parsed
   configuration with every sensitive value replaced by `(redacted)` — by key
   name and by the credential detector. A JSON endpoint is the easier of the two
   surfaces to scrape, and it is held to the same rule as the page.
5. **An absent section is `null`, not an empty object.** As in a report, "not
   collected" and "nothing found" are different answers.

`404` bodies are JSON for `/api` paths and an HTML page otherwise.

## MCP interface (GATE 7)

See [MCP.md](MCP.md). Read-only.
