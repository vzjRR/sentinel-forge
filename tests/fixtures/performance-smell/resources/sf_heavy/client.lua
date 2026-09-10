-- PERF-LOOP-001: a thread that never yields.
CreateThread(function()
    while true do
        local player = PlayerPedId()
        local coords = GetEntityCoords(player)
        -- No Wait() anywhere in this loop body.
        TriggerServerEvent('sf_heavy:position', coords)
    end
end)

-- PERF-EVENT-001: a network trigger inside a per-frame loop.
CreateThread(function()
    while true do
        Wait(0)
        TriggerServerEvent('sf_heavy:heartbeat')
    end
end)
