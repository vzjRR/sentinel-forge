/**
 * @sentinel-forge/shared — contracts shared across every Sentinel Forge package.
 *
 * This package contains types, constants and pure functions only. It must stay
 * free of I/O so that contracts can be consumed by the CLI, the runtime
 * collector, the report writer and (later) the dashboard without pulling in
 * platform dependencies.
 *
 * © 2026 Talal Al Ghafri. All Rights Reserved.
 */

export * from './product.js';
export * from './severity.js';
export * from './confidence.js';
export * from './evidence.js';
export * from './finding.js';
export * from './health.js';
export * from './resource.js';
export * from './exit-codes.js';
export * from './rules/catalog.js';
export * from './report/schema.js';
export * from './report/validate.js';
