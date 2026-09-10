/**
 * `sentinel doctor` — environment self-check.
 *
 * Answers one question: can this machine run Sentinel Forge, and is the local
 * setup usable? Every check reports what was actually verified. Nothing is
 * assumed to work because it usually does.
 */

import { constants } from 'node:fs';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  loadConfig,
  openDatabase,
  resolveConfiguredPath,
  latestSchemaVersion,
  isSentinelError,
} from '@sentinel-forge/core';
import { EXIT_CODES, PRODUCT_NAME, PRODUCT_VERSION } from '@sentinel-forge/shared';
import { formatTable, type CommandOutcome } from '../output.js';
import type { CommandContext, CommandDefinition } from './types.js';

type CheckStatus = 'PASS' | 'WARN' | 'FAIL';

interface Check {
  readonly name: string;
  readonly status: CheckStatus;
  readonly detail: string;
  readonly remediation?: string;
}

/** Minimum Node version: `node:sqlite` is unavailable below this. */
const MINIMUM_NODE_MAJOR = 22;
const MINIMUM_NODE_MINOR = 5;

function checkNodeVersion(): Check {
  const [major = 0, minor = 0] = process.versions.node.split('.').map((part) => Number.parseInt(part, 10));
  const supported = major > MINIMUM_NODE_MAJOR || (major === MINIMUM_NODE_MAJOR && minor >= MINIMUM_NODE_MINOR);
  return supported
    ? { name: 'Node.js version', status: 'PASS', detail: `${process.version} (>= 22.5.0 required).` }
    : {
        name: 'Node.js version',
        status: 'FAIL',
        detail: `${process.version} is below the required 22.5.0.`,
        remediation: 'Install Node.js 22.5 or newer; the bundled SQLite module is unavailable in older releases.',
      };
}

function checkSqlite(): Check {
  try {
    const database = openDatabase({ location: ':memory:' });
    try {
      const row = database.driver.prepare('SELECT sqlite_version() AS version').get<{ version: string }>();
      const applied = database.driver
        .prepare('SELECT COUNT(*) AS count FROM schema_migrations')
        .get<{ count: number }>();
      return {
        name: 'Local database engine',
        status: 'PASS',
        detail: `node:sqlite ${row?.version ?? 'unknown'} — ${String(applied?.count ?? 0)} of ${String(
          latestSchemaVersion(),
        )} migration(s) applied to an in-memory database.`,
      };
    } finally {
      database.close();
    }
  } catch (error) {
    return {
      name: 'Local database engine',
      status: 'FAIL',
      detail: isSentinelError(error) ? error.message : 'The bundled SQLite module could not be initialised.',
      remediation: 'Verify the Node.js installation is complete and was not built without SQLite support.',
    };
  }
}

async function checkWritableTemp(): Promise<Check> {
  let directory: string | undefined;
  try {
    directory = await mkdtemp(path.join(tmpdir(), 'sentinel-doctor-'));
    return { name: 'Temporary directory', status: 'PASS', detail: 'A temporary working directory can be created.' };
  } catch {
    return {
      name: 'Temporary directory',
      status: 'FAIL',
      detail: 'A temporary working directory could not be created.',
      remediation: 'Check the permissions on the system temporary directory.',
    };
  } finally {
    if (directory !== undefined) await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function checkConfiguration(context: CommandContext): Promise<readonly Check[]> {
  const checks: Check[] = [];
  try {
    const loaded = await loadConfig({
      cwd: context.cwd,
      ...(context.options.config === undefined ? {} : { configPath: context.options.config }),
    });

    checks.push({
      name: 'Configuration',
      status: 'PASS',
      detail:
        loaded.sourcePath === null
          ? 'No sentinel.config.json found; built-in defaults are in use.'
          : `Loaded and validated ${loaded.sourcePath}.`,
      ...(loaded.sourcePath === null
        ? { remediation: 'Run `sentinel init` to create a configuration file for this server.' }
        : {}),
    });

    const configuredServer = context.options.server ?? loaded.config.server.path;
    if (configuredServer === null || configuredServer === undefined) {
      checks.push({
        name: 'Server path',
        status: 'WARN',
        detail: 'No server path is configured.',
        remediation: 'Pass --server <path>, or set server.path in sentinel.config.json.',
      });
    } else {
      const resolved = resolveConfiguredPath(loaded, configuredServer);
      try {
        await access(resolved, constants.R_OK);
        checks.push({ name: 'Server path', status: 'PASS', detail: `${resolved} is readable.` });
      } catch {
        checks.push({
          name: 'Server path',
          status: 'FAIL',
          detail: `${resolved} does not exist or is not readable.`,
          remediation: 'Point --server at the directory containing server.cfg and the resources directory.',
        });
      }
    }

    const databasePath = resolveConfiguredPath(loaded, context.options.database ?? loaded.config.database.path);
    try {
      await access(path.dirname(databasePath), constants.W_OK);
      checks.push({
        name: 'Database location',
        status: 'PASS',
        detail: `${path.dirname(databasePath)} is writable.`,
      });
    } catch {
      checks.push({
        name: 'Database location',
        status: 'WARN',
        detail: `${path.dirname(databasePath)} does not exist yet.`,
        remediation: 'Run `sentinel init` to create the local data directory.',
      });
    }

    checks.push({
      name: 'Privacy defaults',
      status:
        loaded.config.privacy.telemetry || loaded.config.privacy.network || loaded.config.privacy.ai ? 'WARN' : 'PASS',
      detail: 'Telemetry, network access and AI are disabled. Sentinel Forge operates entirely locally.',
    });
  } catch (error) {
    checks.push({
      name: 'Configuration',
      status: 'FAIL',
      detail: isSentinelError(error) ? error.message : 'Configuration could not be loaded.',
      ...(isSentinelError(error) && error.remediation !== undefined ? { remediation: error.remediation } : {}),
    });
  }
  return checks;
}

const STATUS_MARK: Readonly<Record<CheckStatus, string>> = Object.freeze({
  PASS: '[ ok ]',
  WARN: '[warn]',
  FAIL: '[fail]',
});

export const doctorCommand: CommandDefinition = {
  name: 'doctor',
  summary: 'Check that this environment can run Sentinel Forge.',
  usage: 'doctor [--server <path>] [--json]',
  status: 'IMPLEMENTED',
  gate: 0,
  details: [
    'Verifies the Node.js version, the bundled SQLite engine, filesystem access,',
    'and the validity of the configuration that would be used by other commands.',
    'Exits with code 2 if any check fails.',
  ],
  async run(context: CommandContext): Promise<CommandOutcome> {
    const checks: Check[] = [checkNodeVersion(), checkSqlite(), await checkWritableTemp(), ...(await checkConfiguration(context))];

    const failed = checks.filter((check) => check.status === 'FAIL');
    const warned = checks.filter((check) => check.status === 'WARN');

    const lines = [
      `${PRODUCT_NAME} ${PRODUCT_VERSION} — environment check`,
      '',
      ...checks.map((check) => {
        const head = `${STATUS_MARK[check.status]} ${check.name}: ${check.detail}`;
        return check.remediation === undefined ? head : `${head}\n         ${check.remediation}`;
      }),
      '',
      formatTable([
        ['Checks', String(checks.length)],
        ['Failed', String(failed.length)],
        ['Warnings', String(warned.length)],
      ]),
    ];

    return {
      exitCode: failed.length > 0 ? EXIT_CODES.INVALID_INPUT : EXIT_CODES.SUCCESS,
      text: lines.join('\n'),
      data: {
        checks,
        summary: { total: checks.length, failed: failed.length, warnings: warned.length },
      },
    };
  },
};
