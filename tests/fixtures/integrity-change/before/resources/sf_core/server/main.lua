RegisterNetEvent('sf_core:ping', function()
    local source = source
    TriggerClientEvent('sf_core:pong', source)
end)
