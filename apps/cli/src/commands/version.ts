/**
 * `sentinel version` — build and contract versions.
 *
 * Prints the schema versions alongside the product version because those are
 * what an integrator actually needs to know when a report or database does not
 * match their expectations.
 */

import {
  DATABASE_SCHEMA_VERSION,
  INDEPENDENCE_NOTICE,
  PRODUCT_COPYRIGHT,
  PRODUCT_DEVELOPER,
  PRODUCT_NAME,
  PRODUCT_OWNER,
  PRODUCT_SUBTITLE,
  PRODUCT_VERSION,
  REPORT_SCHEMA_VERSION,
} from '@sentinel-forge/shared';
import { formatTable, ok } from '../output.js';
import type { CommandDefinition } from './types.js';

export const versionCommand: CommandDefinition = {
  name: 'version',
  summary: 'Print product, report schema and database schema versions.',
  usage: 'version [--json]',
  status: 'IMPLEMENTED',
  gate: 0,
  run(): Promise<ReturnType<typeof ok>> {
    const text = [
      `${PRODUCT_NAME} ${PRODUCT_VERSION} — ${PRODUCT_SUBTITLE}`,
      '',
      formatTable([
        ['Product version', PRODUCT_VERSION],
        ['Report schema', REPORT_SCHEMA_VERSION],
        ['Database schema', String(DATABASE_SCHEMA_VERSION)],
        ['Node.js', process.version],
        ['Platform', `${process.platform}-${process.arch}`],
      ]),
      '',
      `Created and developed by ${PRODUCT_OWNER}`,
      `Developer: ${PRODUCT_DEVELOPER}`,
      PRODUCT_COPYRIGHT,
      '',
      INDEPENDENCE_NOTICE,
    ].join('\n');

    return Promise.resolve(
      ok(text, {
        product: PRODUCT_NAME,
        version: PRODUCT_VERSION,
        reportSchemaVersion: REPORT_SCHEMA_VERSION,
        databaseSchemaVersion: DATABASE_SCHEMA_VERSION,
        node: process.version,
        platform: `${process.platform}-${process.arch}`,
        owner: PRODUCT_OWNER,
        developer: PRODUCT_DEVELOPER,
      }),
    );
  },
};
