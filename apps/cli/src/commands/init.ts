/**
 * `sentinel init` — prepare a working directory.
 *
 * Creates the configuration file, the local data directory and the SQLite
 * database. The command is idempotent: running it again never overwrites an
 * existing configuration, so it is safe to call from a setup script.
 *
 * It does not modify the FiveM server in any way. Nothing outside the working
 * directory is written.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  CONFIG_FILE_NAME,
  DATA_DIRECTORY_NAME,
  DEFAULT_CONFIG,
  SentinelUserError,
  loadConfig,
  openDatabase,
  resolveConfiguredPath,
} from '@sentinel-forge/core';
import { PRODUCT_NAME } from '@sentinel-forge/shared';
import { formatTable, ok, type CommandOutcome } from '../output.js';
import type { CommandContext, CommandDefinition } from './types.js';

interface InitActions {
  readonly configPath: string;
  readonly configCreated: boolean;
  readonly dataDirectory: string;
  readonly databasePath: string;
  readonly migrationsApplied: readonly string[];
}

function renderConfigFile(serverPath: string | null): string {
  const config = {
    server: {
      path: serverPath,
      resourceDirectories: DEFAULT_CONFIG.server.resourceDirectories,
    },
    database: { path: DEFAULT_CONFIG.database.path },
    scan: {
      maxFileBytes: DEFAULT_CONFIG.scan.maxFileBytes,
      maxDepth: DEFAULT_CONFIG.scan.maxDepth,
      maxFiles: DEFAULT_CONFIG.scan.maxFiles,
      followSymlinks: DEFAULT_CONFIG.scan.followSymlinks,
      skipDirectories: DEFAULT_CONFIG.scan.skipDirectories,
    },
    analysis: {
      minimumSeverity: DEFAULT_CONFIG.analysis.minimumSeverity,
      failOnSeverity: DEFAULT_CONFIG.analysis.failOnSeverity,
      disabledRules: DEFAULT_CONFIG.analysis.disabledRules,
    },
    logging: { level: DEFAULT_CONFIG.logging.level, format: DEFAULT_CONFIG.logging.format },
    reports: { outputDirectory: DEFAULT_CONFIG.reports.outputDirectory },
    retention: { ...DEFAULT_CONFIG.retention },
    privacy: { ...DEFAULT_CONFIG.privacy },
  };
  return `${JSON.stringify(config, null, 2)}\n`;
}

async function performInit(context: CommandContext): Promise<InitActions> {
  const configPath = path.resolve(context.cwd, context.options.config ?? CONFIG_FILE_NAME);
  const serverPath = context.options.server ?? null;

  if (serverPath !== null && !existsSync(path.resolve(context.cwd, serverPath))) {
    throw new SentinelUserError(`Server path does not exist: ${serverPath}`, {
      remediation: 'Point --server at the directory containing server.cfg, for example:\n  sentinel init --server "/opt/fxserver"',
    });
  }

  let configCreated = false;
  if (existsSync(configPath)) {
    context.logger.info('Configuration already exists; leaving it unchanged.', { configPath });
  } else {
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(configPath, renderConfigFile(serverPath), 'utf8');
    configCreated = true;
  }

  const loaded = await loadConfig({ cwd: context.cwd, configPath });
  const dataDirectory = path.resolve(context.cwd, DATA_DIRECTORY_NAME);
  await mkdir(dataDirectory, { recursive: true });
  await mkdir(resolveConfiguredPath(loaded, loaded.config.reports.outputDirectory), { recursive: true });

  const databasePath = resolveConfiguredPath(loaded, context.options.database ?? loaded.config.database.path);
  const database = openDatabase({ location: databasePath, logger: context.logger });
  try {
    return {
      configPath,
      configCreated,
      dataDirectory,
      databasePath,
      migrationsApplied: database.migration?.applied.map((migration) => migration.fileName) ?? [],
    };
  } finally {
    database.close();
  }
}

export const initCommand: CommandDefinition = {
  name: 'init',
  summary: 'Create the local configuration, data directory and database.',
  usage: 'init [--server <path>] [--config <path>] [--json]',
  status: 'IMPLEMENTED',
  gate: 0,
  details: [
    'Writes sentinel.config.json in the working directory, creates the .sentinel',
    'data directory, and applies database migrations. Existing configuration is',
    'never overwritten. The FiveM server itself is not modified.',
  ],
  async run(context: CommandContext): Promise<CommandOutcome> {
    const actions = await performInit(context);

    const text = [
      `${PRODUCT_NAME} initialised in ${context.cwd}`,
      '',
      formatTable([
        ['Configuration', `${actions.configPath}${actions.configCreated ? ' (created)' : ' (existing, unchanged)'}`],
        ['Data directory', actions.dataDirectory],
        ['Database', actions.databasePath],
        [
          'Migrations',
          actions.migrationsApplied.length === 0
            ? 'already up to date'
            : `applied ${actions.migrationsApplied.join(', ')}`,
        ],
      ]),
      '',
      'Next: run `sentinel doctor` to verify the environment.',
    ].join('\n');

    return ok(text, {
      configPath: actions.configPath,
      configCreated: actions.configCreated,
      dataDirectory: actions.dataDirectory,
      databasePath: actions.databasePath,
      migrationsApplied: actions.migrationsApplied,
    });
  },
};
