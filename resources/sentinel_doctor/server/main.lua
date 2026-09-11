--- Sentinel Forge runtime collector — entry point.
---
--- Constraints this resource holds to, by design and not by convention:
---
---   * it does not inject code into other resources;
---   * it does not modify other resources or the server configuration;
---   * it does not download or execute anything;
---   * it does not read player identifiers, names, endpoints or positions;
---   * it makes no network request of any kind;
---   * it writes only inside its own resource directory.
---
--- Overhead is the other design constraint. Collection is event-driven where an
--- event exists, and the one polling thread wakes twice a second, does a
--- subtraction, and sleeps again. A diagnostic tool that degrades the server it
--- is diagnosing is worse than no tool.
---
--- © 2026 Talal Al Ghafri. All Rights Reserved.

local startedAt = GetGameTimer()
local flushFailures = 0

--- Samples scheduler latency on a fixed interval.
---
--- The measurement is the difference between the interval requested and the
--- interval actually observed. That lateness is what an operator experiences as
--- a hitch, measured from inside the runtime that caused it.
local function latencyThread()
    local interval = SentinelConfig.sampleIntervalMs

    while true do
        local before = GetGameTimer()
        Wait(interval)
        local lateness = Collector.measureLatency(interval, before)
        Collector.addSample('scheduler_latency_ms', lateness, 'ms')
    end
end

--- Sweeps resource states periodically, catching anything the events missed.
local function stateThread()
    -- An immediate sweep records the starting state of every resource, which is
    -- the baseline every later transition is read against.
    Collector.sweepResourceStates()

    while true do
        Wait(SentinelConfig.stateIntervalMs)
        Collector.sweepResourceStates()
    end
end

--- Writes buffered telemetry to disk periodically.
local function flushThread()
    while true do
        Wait(SentinelConfig.flushIntervalMs)

        local payload = Collector.drain()
        if #payload.samples > 0 or #payload.events > 0 then
            local ok, message = Writer.write(payload)
            if not ok then
                flushFailures = flushFailures + 1
                -- Reported once per failure rather than silently retried: an
                -- operator needs to know telemetry is not reaching disk.
                print(('[sentinel_doctor] %s'):format(message))
            end
        end
    end
end

AddEventHandler('onResourceStart', function(resource)
    if resource == GetCurrentResourceName() then
        return
    end
    Collector.recordTransition('resource_started', resource)
end)

AddEventHandler('onResourceStop', function(resource)
    if resource == GetCurrentResourceName() then
        return
    end
    Collector.recordTransition('resource_stopped', resource)
end)

--- Flushes whatever is buffered when the collector itself is stopped, so a
--- restart does not discard the window leading up to it.
AddEventHandler('onResourceStop', function(resource)
    if resource ~= GetCurrentResourceName() then
        return
    end

    local payload = Collector.drain()
    if #payload.samples > 0 or #payload.events > 0 then
        Writer.write(payload)
    end
end)

--- Reports what the collector is doing, and what it cannot do.
RegisterCommand('sentinel_doctor', function()
    local stats = Collector.stats()
    print('[sentinel_doctor] Sentinel Forge runtime collector')
    print(('  enabled: %s'):format(tostring(SentinelConfig.enabled)))
    print(('  uptime: %d ms'):format(GetGameTimer() - startedAt))
    print(('  buffered: %d sample(s), %d event(s)'):format(stats.bufferedSamples, stats.bufferedEvents))
    print(('  dropped: %d sample(s), %d event(s)'):format(stats.droppedSamples, stats.droppedEvents))
    print(('  flush failures: %d'):format(flushFailures))
    print('  measures: scheduler latency, resource state, resource transitions, player count')
    print('  does NOT measure: per-resource CPU or tick time — FiveM exposes no scripting API for it')
end, true)

if SentinelConfig.enabled then
    CreateThread(latencyThread)
    CreateThread(stateThread)
    CreateThread(flushThread)
    print('[sentinel_doctor] collector started. Run `sentinel_doctor` in the console for status.')
else
    print('[sentinel_doctor] collector is disabled by convar sentinel_enabled.')
end
