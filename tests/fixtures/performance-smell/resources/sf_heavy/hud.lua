-- False-positive control: Wait(0) is a legitimate per-frame pattern.
-- PERF-LOOP-001 must not report this loop.
CreateThread(function()
    while true do
        Wait(0)
        DrawRect(0.5, 0.5, 0.1, 0.1, 255, 255, 255, 100)
    end
end)
