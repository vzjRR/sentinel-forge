--- Sentinel Forge runtime collector — measurement.
---
--- WHAT THIS COLLECTOR CAN AND CANNOT MEASURE
---
--- FiveM exposes no scripting API for per-resource CPU or tick time on the
--- server. The official profiler (`profiler record` / `profiler saveJSON`) is a
--- console command that writes a file; it cannot be driven from a script, and
--- nothing else exposes another resource's timing.
---
--- So this collector does not report per-resource timing. Inventing a number
--- there would corrupt every baseline and regression comparison built on it,
--- which is worse than reporting nothing.
---
--- What it does measure is real:
---
---   * **Scheduler latency** — the difference between how long this thread
---     asked to wait and how long it actually waited. When the server runtime
---     is busy or stalled, threads are serviced late, and that lateness is the
---     same phenomenon an operator experiences as hitching. It is a property of
---     the server, observed from inside it.
---   * **Resource state** — via GetResourceState, which is a documented shared
---     native returning one of: missing, started, starting, stopped, stopping,
---     uninitialized, unknown.
---   * **Resource state transitions** — via the documented onResourceStart and
---     onResourceStop server events.
---   * **Player count** — a count only, via GetNumPlayerIndices. No identifier,
---     name, endpoint or position is read or recorded.
---
--- Natives used here are verified against the official declarations in
--- citizenfx/fivem (ext/native-decls) and docs.fivem.net.
---
--- © 2026 Talal Al Ghafri. All Rights Reserved.

Collector = {}

--- Buffered samples awaiting a flush.
local samples = {}
--- Buffered state transitions awaiting a flush.
local events = {}
--- Last observed state per resource, so a sweep only records changes.
local lastState = {}
--- Counts of what was dropped because a buffer was full, so the report can say so.
local dropped = { samples = 0, events = 0 }

--- Monotonic milliseconds since the server started.
--- GetGameTimer is a documented shared native.
local function nowMs()
    return GetGameTimer()
end

--- Wall-clock seconds, for timestamps the CLI can align with its own records.
local function nowEpochSeconds()
    return os.time()
end

--- Player count, or nil when the collector is configured not to record it.
local function playerCount()
    if not SentinelConfig.recordPlayerCount then
        return nil
    end
    return GetNumPlayerIndices()
end

--- Records a measured sample. Values are never estimated or interpolated.
function Collector.addSample(metric, value, unit)
    if #samples >= SentinelConfig.maxBufferedSamples then
        dropped.samples = dropped.samples + 1
        return false
    end

    samples[#samples + 1] = {
        metric = metric,
        value = value,
        unit = unit,
        playerCount = playerCount(),
        at = nowEpochSeconds()
    }
    return true
end

--- Records an observed event, such as a resource state transition.
function Collector.addEvent(kind, resource, detail)
    if #events >= SentinelConfig.maxBufferedSamples then
        dropped.events = dropped.events + 1
        return false
    end

    events[#events + 1] = {
        kind = kind,
        resource = resource,
        detail = detail,
        playerCount = playerCount(),
        at = nowEpochSeconds()
    }
    return true
end

--- Measures how much later than requested this thread was serviced.
---
--- The caller passes the interval it asked to wait and the timer reading from
--- before the wait. The difference is the lateness. A value near zero means the
--- scheduler kept up; a large value means it did not.
---
--- @param requestedMs number the interval passed to Wait
--- @param beforeMs number the timer reading taken before the wait
--- @return number lateness in milliseconds, never negative
function Collector.measureLatency(requestedMs, beforeMs)
    local elapsed = nowMs() - beforeMs
    local lateness = elapsed - requestedMs
    if lateness < 0 then
        -- The timer has millisecond resolution, so a wait can appear marginally
        -- short. Reporting a negative latency would be reporting noise as data.
        return 0
    end
    return lateness
end

--- Sweeps every resource and records any state that changed since the last sweep.
---
--- Uses GetNumResources / GetResourceByFindIndex / GetResourceState, all
--- documented shared natives.
---
--- @return number the number of state changes recorded
function Collector.sweepResourceStates()
    local changes = 0
    local total = GetNumResources()

    for index = 0, total - 1 do
        local resource = GetResourceByFindIndex(index)
        if resource then
            local state = GetResourceState(resource)
            if lastState[resource] ~= state then
                -- The first sweep records every resource's state as an
                -- observation, not as a change: there is nothing to compare to.
                local kind = lastState[resource] == nil and 'resource_state' or 'resource_state_changed'
                Collector.addEvent(kind, resource, state)
                lastState[resource] = state
                changes = changes + 1
            end
        end
    end

    return changes
end

--- Current state of a single resource, or 'unknown'.
function Collector.resourceState(resource)
    local state = GetResourceState(resource)
    if state == nil or state == '' then
        return 'unknown'
    end
    return state
end

--- Records a resource transition reported by a server event.
function Collector.recordTransition(kind, resource)
    lastState[resource] = Collector.resourceState(resource)
    Collector.addEvent(kind, resource, lastState[resource])
end

--- Hands over everything buffered and clears the buffers.
function Collector.drain()
    local payload = {
        samples = samples,
        events = events,
        dropped = { samples = dropped.samples, events = dropped.events }
    }

    samples = {}
    events = {}
    dropped = { samples = 0, events = 0 }

    return payload
end

--- Current buffer sizes, for the status command.
function Collector.stats()
    return {
        bufferedSamples = #samples,
        bufferedEvents = #events,
        droppedSamples = dropped.samples,
        droppedEvents = dropped.events
    }
end
