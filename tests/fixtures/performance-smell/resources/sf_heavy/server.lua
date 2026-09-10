-- PERF-QUERY-001: a query executed once per iteration, and unbounded selection.
RegisterNetEvent('sf_heavy:position', function(coords)
    for i = 1, 100 do
        MySQL.query('SELECT * FROM sf_positions WHERE owner = ' .. tostring(i))
    end
end)

-- Parameterized query, included as the safer counter-example.
RegisterNetEvent('sf_heavy:lookup', function(identifier)
    MySQL.query('SELECT id, name FROM sf_players WHERE identifier = ? LIMIT 1', { identifier })
end)
