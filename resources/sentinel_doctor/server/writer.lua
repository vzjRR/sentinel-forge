--- Sentinel Forge runtime collector — writing telemetry to disk.
---
--- Telemetry is written into this resource's own directory using
--- SaveResourceFile, a documented server native. The Sentinel Forge CLI reads
--- those files during a scan.
---
--- Nothing is sent anywhere. The collector opens no socket, makes no HTTP
--- request, and writes nothing outside its own resource directory.
---
--- © 2026 Talal Al Ghafri. All Rights Reserved.

Writer = {}

--- Schema version of the telemetry file. The CLI refuses a version it does not
--- understand rather than guessing at the shape.
local TELEMETRY_SCHEMA_VERSION = '1.0'

--- Files are written in rotation, so disk use stays bounded and the collector
--- never deletes a file it did not create.
local fileIndex = 0

--- Encodes a payload as JSON.
--- `json` is provided globally by the FiveM Lua runtime (dkjson 2.5).
local function encode(payload)
    local ok, encoded = pcall(json.encode, payload)
    if not ok then
        return nil, tostring(encoded)
    end
    return encoded, nil
end

--- Writes one telemetry file.
---
--- @param payload table drained buffers from the collector
--- @return boolean success
--- @return string|nil errorMessage
function Writer.write(payload)
    local resourceName = GetCurrentResourceName()

    local document = {
        schemaVersion = TELEMETRY_SCHEMA_VERSION,
        collector = 'sentinel_doctor',
        collectorVersion = GetResourceMetadata(resourceName, 'version', 0),
        -- Written in UTC seconds since the epoch; the CLI converts it.
        writtenAt = os.time(),
        -- How long the server has been running, in milliseconds. Context for
        -- reading latency samples: a server that just started is not comparable
        -- with one that has been up for a week.
        serverUptimeMs = GetGameTimer(),
        samples = payload.samples,
        events = payload.events,
        -- Stated plainly so a report can say analysis was incomplete rather
        -- than presenting a gap as a quiet period.
        dropped = payload.dropped,
        limitations = {
            'FiveM exposes no scripting API for per-resource CPU or tick time on the server, so none is reported.',
            'Scheduler latency is measured from inside this resource. It reflects how promptly the server serviced this thread.',
            'Player counts are counts only. No player identifier, name, endpoint or position is read or recorded.'
        }
    }

    local encoded, encodeError = encode(document)
    if encoded == nil then
        return false, 'telemetry could not be encoded: ' .. tostring(encodeError)
    end

    fileIndex = (fileIndex % SentinelConfig.maxFiles) + 1
    local fileName = ('telemetry/sentinel-telemetry-%02d.json'):format(fileIndex)

    -- SaveResourceFile writes inside the named resource. -1 lets the runtime
    -- determine the length.
    local written = SaveResourceFile(resourceName, fileName, encoded, -1)
    if not written then
        return false, 'telemetry file could not be written: ' .. fileName
    end

    return true, nil
end
