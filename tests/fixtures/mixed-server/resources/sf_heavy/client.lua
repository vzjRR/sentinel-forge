CreateThread(function()
    while true do
        local ped = PlayerPedId()
        SetEntityHealth(ped, 200)
    end
end)
