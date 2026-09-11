--- Sentinel Forge runtime collector — configuration.
---
--- Every value is read from a server convar so an operator can change the
--- collector's behaviour without editing the resource. All defaults are chosen
--- to be quiet: infrequent sampling, bounded buffers, and nothing collected
--- that is not needed for a diagnosis.
---
--- © 2026 Talal Al Ghafri. All Rights Reserved.

SentinelConfig = {}

--- Reads an integer convar, falling back to a default.
--- GetConvarInt is a documented server native.
local function intConvar(name, fallback)
    local value = GetConvarInt(name, fallback)
    if type(value) ~= 'number' or value ~= value then
        return fallback
    end
    return value
end

local function boolConvar(name, fallback)
    local value = GetConvar(name, fallback and 'true' or 'false')
    return value == 'true' or value == '1'
end

--- How often the collector samples scheduler latency, in milliseconds.
--- 500 ms is frequent enough to see a degradation within a minute and rare
--- enough that the collector itself is not a load on the scheduler.
SentinelConfig.sampleIntervalMs = intConvar('sentinel_sample_interval_ms', 500)

--- How often a state sweep runs, in milliseconds. Resource state changes are
--- also caught by events; the sweep exists to notice anything the events miss.
SentinelConfig.stateIntervalMs = intConvar('sentinel_state_interval_ms', 30000)

--- How often buffered telemetry is written to disk, in milliseconds.
SentinelConfig.flushIntervalMs = intConvar('sentinel_flush_interval_ms', 60000)

--- Maximum samples held in memory between flushes. A bound rather than a
--- guideline: an unbounded buffer in a long-running server is a memory leak.
SentinelConfig.maxBufferedSamples = intConvar('sentinel_max_buffered_samples', 5000)

--- Maximum telemetry files kept in the resource directory. Older files are
--- overwritten in rotation, so disk use stays bounded without the collector
--- ever deleting anything it did not create.
SentinelConfig.maxFiles = intConvar('sentinel_max_files', 12)

--- Whether the collector records the player count alongside samples.
--- A count only: no identifier, name, endpoint or position is ever recorded.
SentinelConfig.recordPlayerCount = boolConvar('sentinel_record_player_count', true)

--- Whether the collector runs at all. Set to false to disable it without
--- removing the resource from the server configuration.
SentinelConfig.enabled = boolConvar('sentinel_enabled', true)
