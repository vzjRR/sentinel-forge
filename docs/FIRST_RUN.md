# First run against a real server

© 2026 Talal Al Ghafri. All Rights Reserved.

Sentinel Forge v1.0.0 is feature-complete and has **never been run against a
real FiveM server**. Everything in the test suite is verified against synthetic
fixtures under `tests/fixtures/`.

This document is the checklist for closing that gap. It is written to be handed
to a fresh session, or worked through by hand.

Until it has been completed at least once, treat every number in
[GATE_STATUS.md](GATE_STATUS.md) as "passes its own tests", not "works".

## Setup

Node.js 22.5 or newer.

```bash
npm install && npm run build
npm run sentinel -- init --server "/path/to/fxserver"
npm run sentinel -- doctor
```

Every command below is read-only with respect to the FiveM server. The single
exception is installing the collector (step 3), which adds a resource to it.

## 1. Static analysis

```bash
npm run sentinel -- scan
npm run sentinel -- health
npm run sentinel -- dependencies
npm run sentinel -- security
npm run sentinel -- resource <a real resource name>
```

Record for each: exit code, wall-clock duration, and finding counts by severity.

### What is expected to go wrong, in order of likelihood

1. **Escrow-protected resources (`.fxap`, Cfx asset escrow).** These contain
   encrypted Lua. `packages/lua/src/lexer.ts` will read one as garbage and
   probably emit unterminated-string diagnostics and meaningless findings. No
   fixture covers this.

   The right fix is to detect escrow-protected files during discovery
   (`packages/scanner/src/discovery/discover.ts`) and report them as *not
   analysable because encrypted* — a stated limitation. **Not** to skip them
   silently: a gap is reported as a gap.

2. **`scan.maxFiles` defaults to 200,000** (`packages/core/src/config/schema.ts`).
   A server with a large `stream/` tree can exceed it. The walk reports
   `MAX_ENTRIES_REACHED`; check that the scan output surfaces that clearly
   rather than quietly analysing a subset.

3. **Scan duration.** `tests/performance/scan.test.ts` measures ~190 ms for 500
   generated resources. A real server is a different shape — deeper trees,
   bigger assets, more files per resource. Measure it. Profile before changing
   anything.

4. **Health calibration.** The weights in `packages/analyzer/src/health/score.ts`
   were tuned against fixtures. On a real server the score may be far too harsh
   or too generous. Report the score and its top deductions; do not retune
   without deciding first what the right answer would have been.

5. **False positives.** Every finding on a real server is worth checking by
   hand. `PERF-LOOP-001`, `PERF-QUERY-001` and the `SEC-*` rules are the
   likeliest to misfire on idioms no fixture contains.

## 2. Dashboard

```bash
npm run sentinel -- dashboard        # http://127.0.0.1:7878/
```

Open every page and check:

- nothing renders as `[object Object]` or an empty table where data exists;
- **no configuration value from `server.cfg` is shown in full.**
  `sv_licenseKey`, database connection strings and Discord tokens must appear
  as `(redacted)` — see `apps/dashboard/src/redact.ts`. If a real value
  appears, that is a security defect, not a bug;
- the resource pages remain usable with a realistic resource count rather than
  the three in the fixtures.

## 3. The runtime collector — the highest-risk step

`resources/sentinel_doctor/` has never executed in a real FiveM runtime. Its
constraints are asserted against its own Lua source by
`tests/integration/collector-resource.test.ts`, but that is static analysis of
the collector, not evidence that it runs.

**Use a development server for this first, if one exists.**

```bash
cp -r resources/sentinel_doctor /path/to/fxserver/resources/
# add `ensure sentinel_doctor` to server.cfg, then restart that resource
```

In the server console, `sentinel_doctor` prints its status. Watch for Lua errors
on start. Let it run at least five minutes — it flushes once a minute — then:

```bash
npm run sentinel -- runtime status
npm run sentinel -- runtime import
npm run sentinel -- runtime events
```

Verify that files appear under
`<fxserver>/resources/sentinel_doctor/telemetry/`, that their JSON matches what
`packages/runtime/src/telemetry.ts` expects (schema version `1.0`), and that the
scheduler-latency values are plausible rather than absurd.

### Measure the overhead

No automated test can do this; it needs a running server. The procedure is in
`resources/sentinel_doctor/README.md`:

1. With the collector stopped: `profiler record 500`, wait, `profiler saveJSON before.json`.
2. `ensure sentinel_doctor`, let the server settle five minutes, repeat into `after.json`.
3. Compare. `sentinel_doctor` should not appear among the costly entries.

Per [RELEASE.md](RELEASE.md), measurable overhead is a **release blocker**, not
a known issue.

## 4. End to end

```bash
npm run sentinel -- baseline create before
# change a resource, or simply let the server run under load
npm run sentinel -- runtime import
npm run sentinel -- baseline create after
npm run sentinel -- compare before after
```

A baseline claims the samples imported since the previous one, so the two sides
of the comparison are two measurement windows.

## Ground rules for any fix

Read [GATE_STATUS.md](GATE_STATUS.md) and [../ARCHITECTURE.md](../ARCHITECTURE.md)
first. The non-negotiables:

- **No fake data.** If a value cannot be measured, report `Unavailable` or
  `Not collected` *with the reason*. Never substitute a plausible number.
- **No FiveM API is used before it is verified** against the official native
  declarations in `citizenfx/fivem` (`ext/native-decls`) or docs.fivem.net.
  There is deliberately no per-resource CPU or tick time anywhere in the
  product, because FiveM exposes no scripting API for it.
- **Nothing scanned is ever executed.** Lua is read as data.
- **Secrets are reported by location, never by value.**
- `npm run verify` passes before any commit.
- Anything real-world data breaks gets a regression test — a fixture
  reproducing the real shape, not a loosened assertion.

## Done

- A written record of what worked and what did not, with real numbers: scan
  duration, resource count, finding counts, collector overhead.
- Fixes committed for what broke, each with a test.
- This file and `GATE_STATUS.md` updated to say what was actually observed —
  including whatever is still untested.
