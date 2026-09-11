/**
 * @sentinel-forge/engine — the diagnostic pipeline.
 *
 * Composes discovery, manifest and configuration analysis, script analysis,
 * dependency resolution, health scoring and storage into one scan, so the CLI,
 * the dashboard and the MCP server all run the same analysis rather than three
 * variations of it.
 *
 * © 2026 Talal Al Ghafri. All Rights Reserved.
 */

export * from './scan.js';
export * from './context.js';
export * from './baseline-capture.js';
export * from './incident-signals.js';
