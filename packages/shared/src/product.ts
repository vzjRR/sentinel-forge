/**
 * Sentinel Forge — product identity constants.
 *
 * © 2026 Talal Al Ghafri. All Rights Reserved.
 */

export const PRODUCT_NAME = 'Sentinel Forge';
export const PRODUCT_SUBTITLE = 'FiveM Server Intelligence';
export const PRODUCT_OWNER = 'Talal Al Ghafri';
export const PRODUCT_DEVELOPER = 'vzjRR';
export const PRODUCT_COPYRIGHT = '© 2026 Talal Al Ghafri. All Rights Reserved.';

/**
 * Product version. Semantic Versioning (see docs/RELEASE.md).
 * Kept in sync with the root package.json version by `scripts/check-versions.mjs`.
 */
export const PRODUCT_VERSION = '0.6.0';

/**
 * Report envelope schema version. Independent of PRODUCT_VERSION.
 *
 * 1.1 added the optional `events` section and the optional per-resource
 * `health` object.
 *
 * 1.2 added the optional `performance.runtime` object, describing what the
 * in-server collector measured. It is absent on a server with no collector
 * installed, which is the same thing it means: nothing was measured.
 *
 * Every addition so far has been additive: a 1.0 consumer reading a 1.2 report
 * sees the fields it already knows, unchanged.
 *
 * Breaking changes require a major bump and a documented migration note.
 */
export const REPORT_SCHEMA_VERSION = '1.2';

/**
 * Local database schema version tracked by the migration runner.
 * Incremented by adding a numbered migration under `database/migrations/`.
 */
export const DATABASE_SCHEMA_VERSION = 3;

/**
 * Independence notice. Sentinel Forge is not affiliated with, endorsed by, or
 * sponsored by Rockstar Games, Cfx.re, the FiveM project, or txAdmin.
 */
export const INDEPENDENCE_NOTICE =
  'Sentinel Forge is an independent product. It is not affiliated with, endorsed by, ' +
  'or sponsored by Rockstar Games, Cfx.re, the FiveM project, or txAdmin.';
