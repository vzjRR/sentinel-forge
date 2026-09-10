RegisterNetEvent('sf_core:ping', function()
    local source = source
    -- Modified relative to the `before` snapshot: an extra call was added.
    TriggerClientEvent('sf_core:pong', source, os.time())
end)
