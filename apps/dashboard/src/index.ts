/**
 * @sentinel-forge/dashboard — the local, read-only dashboard.
 *
 * It renders what the other packages produced. It performs no analysis of its
 * own, adds no number that was not measured, and cannot change anything: not
 * the FiveM server, not the configuration, not a stored record.
 *
 * © 2026 Talal Al Ghafri. All Rights Reserved.
 */

export * from './context.js';
export * from './redact.js';
export * from './routes.js';
export * from './server.js';
export * from './views/layout.js';
export * from './views/pages.js';
