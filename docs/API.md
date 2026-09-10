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

`schemaVersion: "1.0"`.

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
  "performance":  { "collected": false, "sampleCount": 0, "regressions": [] },
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

## Rule catalog

```bash
sentinel help rules --json
```

Each entry carries `id`, `category`, `defaultSeverity`, `title`, `rationale`,
`falsePositives`, `status` and `targetGate`. `status` states honestly whether the
rule executes in the current build.

## Local HTTP API (GATE 6)

**NOT IMPLEMENTED.** Planned surface, listed so integrators can see the intended
shape:

```
GET /api/health
GET /api/resources
GET /api/resources/:name
GET /api/findings
GET /api/incidents
GET /api/performance
GET /api/dependencies
GET /api/security
GET /api/integrity
GET /api/reports
```

Read-only, bound to `127.0.0.1`, serving the same types as the report schema.

## MCP interface (GATE 7)

See [MCP.md](MCP.md). Read-only.
