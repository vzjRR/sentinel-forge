-- Synthetic client script. Yields on every iteration.
CreateThread(function()
    while true do
        Wait(Config.UpdateIntervalMs)
        TriggerEvent('sf_core:tick')
    end
end)
