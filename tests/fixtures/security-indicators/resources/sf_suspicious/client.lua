-- SEC-DYNAMIC-EXEC-001: dynamic execution of non-literal input.
RegisterNetEvent('sf_suspicious:run', function(source_code)
    local chunk = loadstring(source_code)
    if chunk then chunk() end
end)
