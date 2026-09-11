/**
 * @sentinel-forge/mcp — a read-only MCP server over local findings.
 *
 * It returns what Sentinel Forge has already analysed and recorded. It cannot
 * modify the FiveM server, execute anything, change configuration, or reach the
 * network — and that is a property of what is registered here, not of what each
 * handler happens to do.
 *
 * © 2026 Talal Al Ghafri. All Rights Reserved.
 */

export * from './protocol.js';
export * from './tools.js';
export * from './server.js';
