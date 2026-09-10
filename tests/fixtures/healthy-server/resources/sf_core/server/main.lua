-- Synthetic server script.
RegisterNetEvent('sf_core:requestState', function()
    local source = source
    TriggerClientEvent('sf_core:state', source, { ready = true })
end)
