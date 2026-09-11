# sentinel_doctor

The Sentinel Forge runtime collector.

© 2026 Talal Al Ghafri. All Rights Reserved.

A server-side FiveM resource that records what the server runtime can actually
be observed to do, and writes it to disk for the Sentinel Forge CLI to read.

## Installation

```
# copy resources/sentinel_doctor into your server's resources directory, then:
ensure sentinel_doctor
```

Run `sentinel_doctor` in the server console for status.

The CLI reads the telemetry it writes:

```bash
sentinel scan --server /path/to/fxserver     # once, so the server is known
sentinel runtime status                      # is the collector installed and writing?
sentinel runtime import                      # read its telemetry into the local database
sentinel runtime events                      # resource state transitions it observed
```

`import` is safe to run on a timer. The collector writes into a fixed rotation
of file names, so the same measurements are on disk across several imports; a
document that has already been imported is skipped rather than counted twice.

Imported samples are attached to the next baseline you capture, which is what
makes two measurement windows comparable:

```bash
sentinel baseline create before-change
# ... change something, let the collector run, then:
sentinel runtime import
sentinel baseline create after-change
sentinel compare before-change after-change
```

## What it measures

| Signal | How | Native or event |
| --- | --- | --- |
| Scheduler latency | The difference between the interval a thread asked to wait and the interval it actually waited. | `GetGameTimer` |
| Resource state | Swept periodically and on transition. | `GetNumResources`, `GetResourceByFindIndex`, `GetResourceState` |
| Resource transitions | Event-driven. | `onResourceStart`, `onResourceStop` |
| Player count | A count only. | `GetNumPlayerIndices` |

Every native and event above is verified against the official declarations in
[citizenfx/fivem](https://github.com/citizenfx/fivem/tree/master/ext/native-decls)
and [docs.fivem.net](https://docs.fivem.net/).

## What it does not measure, and why

**Per-resource CPU and tick time.** FiveM exposes no scripting API for it. The
official profiler (`profiler record`, `profiler saveJSON`) is a console command
that writes a file; it cannot be driven from a script, and nothing else exposes
another resource's timing.

Sentinel Forge therefore reports no per-resource timing. A fabricated number
would corrupt every baseline and regression comparison built on it, which is
worse than reporting nothing at all.

Scheduler latency is the closest honest alternative: it is a real property of
the server, measured from inside it, and it moves for the same reasons an
operator experiences hitching.

## What it will not do

- inject code into other resources
- modify other resources or the server configuration
- download or execute anything
- read player identifiers, names, endpoints or positions
- make a network request of any kind
- write outside its own resource directory

## Overhead

Collection is event-driven where an event exists. The one polling thread wakes
twice a second by default, performs a subtraction and sleeps again; the state
sweep runs every thirty seconds; telemetry is written once a minute.

A diagnostic tool that degrades the server it is diagnosing is worse than no
tool, so the collector's footprint is bounded by design and measured before
every release. What is measured, and where:

| Cost | Measured by | Figure at the shipped defaults |
| --- | --- | --- |
| Disk, worst case (every buffer full at every flush) | `tests/performance/collector.test.ts` | 12.3 MiB total across the 12-file rotation |
| Disk, steady state (one flush of latency samples) | `tests/performance/collector.test.ts` | ~11 KiB per file |
| Cost of importing a full rotation into Sentinel Forge | `tests/performance/collector.test.ts` | ~0.5 s for 60,000 samples |
| **In-server CPU and tick cost** | **not measured automatically** — see below | — |

### Measuring in-server cost

The collector's CPU cost can only be measured inside a running FiveM server,
and no automated test in this repository has one. It is measured by hand before
a release, and an operator can repeat the same procedure on their own server:

1. With the collector stopped, run FiveM's own profiler from the server
   console: `profiler record 500`, wait, then `profiler saveJSON before.json`.
2. `ensure sentinel_doctor`, let the server settle for five minutes, and repeat:
   `profiler record 500`, then `profiler saveJSON after.json`.
3. Compare the two recordings. `sentinel_doctor` should not appear among the
   costly entries; the shipped defaults do a subtraction twice a second and a
   file write once a minute.

`profiler` is a console command. It cannot be driven from a script, which is
also why the collector cannot read per-resource timing itself.

## Configuration

All settings are server convars, so nothing in this resource needs editing:

| Convar | Default | Meaning |
| --- | --- | --- |
| `sentinel_enabled` | `true` | Set `false` to disable collection without removing the resource. |
| `sentinel_sample_interval_ms` | `500` | Latency sampling interval. |
| `sentinel_state_interval_ms` | `30000` | Resource state sweep interval. |
| `sentinel_flush_interval_ms` | `60000` | How often telemetry is written to disk. |
| `sentinel_max_buffered_samples` | `5000` | Buffer bound. Anything beyond it is dropped and the drop is reported. |
| `sentinel_max_files` | `12` | Telemetry files kept in rotation. |
| `sentinel_record_player_count` | `true` | Set `false` to omit player counts entirely. |

## Interaction with integrity snapshots

The telemetry files rotate, so they change between any two integrity snapshots
and will appear in `sentinel integrity compare` output. They are deliberately
not excluded from integrity tracking: a directory the integrity check is told to
ignore is exactly the directory worth hiding something in.

## Privacy

The collector records a player **count** and nothing else about players. No
identifier, name, endpoint, position or action is read or stored. There is no
player surveillance in this resource, and none is planned.
