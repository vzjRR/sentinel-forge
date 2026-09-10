/**
 * `sentinel purge` — delete locally stored data.
 *
 * Purge only ever touches Sentinel Forge's own database. Nothing belonging to
 * the FiveM server is read for deletion, let alone deleted.
 */

import { describeStorage, openDatabase, purge, SentinelUserError } from '@sentinel-forge/core';
import { EXIT_CODES } from '@sentinel-forge/shared';
import { formatTable, type CommandOutcome } from '../output.js';
import { resolveScanContext } from '../scan-context.js';
import type { CommandContext, CommandDefinition } from './types.js';

export const purgeCommand: CommandDefinition = {
  name: 'purge',
  summary: 'Delete locally stored Sentinel Forge data.',
  usage: 'purge [retention|all] [--confirm] [--server <path>] [--json]',
  status: 'IMPLEMENTED',
  gate: 3,
  details: [
    'retention  Expire records older than the configured retention windows.',
    'all        Delete every record for this server.',
    '',
    'Runs as a dry run by default: it reports what would be deleted and deletes',
    'nothing. Pass --confirm to carry it out.',
    '',
    'Only Sentinel Forge data is affected. The FiveM server is never modified.',
  ],
  async run(context: CommandContext): Promise<CommandOutcome> {
    const scopeArgument = (context.positionals[0] ?? 'retention').toLowerCase();
    if (scopeArgument !== 'retention' && scopeArgument !== 'all') {
      throw new SentinelUserError(`Unknown purge scope: ${scopeArgument}`, {
        remediation: 'Supported scopes: retention, all.',
      });
    }

    const resolved = await resolveScanContext(context);
    const database = openDatabase({ location: resolved.databasePath, logger: context.logger });

    try {
      const server = database.driver
        .prepare('SELECT id FROM servers WHERE path = ?')
        .get<{ id: string }>(resolved.serverPath);

      // A dry run is the default: deleting history is not reversible, and a
      // command that destroys data by default is a command that will one day
      // destroy data nobody meant to lose.
      const confirmed = context.options.confirm;
      const result = purge(database.driver, {
        ...(server === undefined ? {} : { serverId: server.id }),
        scope: scopeArgument === 'all' ? 'ALL' : 'RETENTION',
        policy: resolved.loaded.config.retention,
        dryRun: !confirmed,
        now: context.clock.now(),
      });

      const remaining = describeStorage(database.driver, server?.id);

      const lines = [
        confirmed
          ? `Deleted ${String(result.total)} record(s) (${result.scope.toLowerCase()}).`
          : `Dry run: ${String(result.total)} record(s) would be deleted (${result.scope.toLowerCase()}).`,
        '',
        Object.keys(result.deleted).length === 0
          ? '  Nothing matched.'
          : formatTable(Object.entries(result.deleted).map(([table, count]) => [table, String(count)] as const)),
        '',
        'Remaining:',
        formatTable(remaining.filter((entry) => entry.rows > 0).map((entry) => [entry.table, String(entry.rows)] as const)),
      ];

      if (!confirmed) {
        lines.push('', 'Nothing was deleted. Re-run with --confirm to carry this out.');
      }

      lines.push('', 'Only Sentinel Forge data is affected. The FiveM server is never modified.');

      return {
        exitCode: EXIT_CODES.SUCCESS,
        text: lines.join('\n'),
        data: { dryRun: !confirmed, scope: result.scope, deleted: result.deleted, total: result.total, remaining },
      };
    } finally {
      database.close();
    }
  },
};
