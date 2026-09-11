fx_version 'cerulean'
game 'common'

name 'sentinel_doctor'
author 'Talal Al Ghafri'
description 'Sentinel Forge runtime collector. Records resource state and scheduler latency, and writes them to disk for the Sentinel Forge CLI to read.'
version '0.6.0'
repository 'https://github.com/vzjRR/sentinel-forge'

-- Server only. The collector observes the server runtime and writes files; it
-- has no client-side behaviour and sends nothing to players.
server_scripts {
    'server/config.lua',
    'server/collector.lua',
    'server/writer.lua',
    'server/main.lua'
}
