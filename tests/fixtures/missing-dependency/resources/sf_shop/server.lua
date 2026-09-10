RegisterNetEvent('sf_shop:buy', function(itemId)
    local source = source
    TriggerClientEvent('sf_shop:bought', source, itemId)
end)
