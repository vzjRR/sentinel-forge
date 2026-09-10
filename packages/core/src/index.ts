/**
 * @sentinel-forge/core — the foundation every other package builds on.
 *
 * Contains configuration, structured logging with redaction, the error model,
 * contained filesystem access, hashing, the local SQLite layer, and the rule
 * engine interfaces. It performs no analysis of its own.
 *
 * © 2026 Talal Al Ghafri. All Rights Reserved.
 */

export * from './errors.js';
export * from './clock.js';
export * from './ids.js';

export * from './logging/logger.js';
export * from './logging/redaction.js';

export * from './config/schema.js';
export * from './config/validate.js';
export * from './config/load.js';

export * from './fs/paths.js';
export * from './fs/read.js';
export * from './fs/walk.js';
export * from './fs/hash.js';

export * from './db/driver.js';
export * from './db/node-sqlite.js';
export * from './db/migrate.js';
export * from './db/open.js';

export * from './rules/rule.js';
export * from './rules/registry.js';
export * from './rules/finding-builder.js';
