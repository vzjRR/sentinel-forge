/**
 * `sentinel incidents` — recorded incident timelines.
 */

import { openDatabase, SentinelUserError } from '@sentinel-forge/core';
import { EXIT_CODES } from '@sentinel-forge/shared';
import { listIncidents } from '@sentinel-forge/incidents';
import { formatTable, type CommandOutcome } from '../output.js';
import { resolveScanContext } from '../scan-context.js';
import type { CommandContext, CommandDefinition } from './types.js';

export const incidentsCommand: CommandDefinition = {
  name: 'incidents',
  summary: 'List correlated incidents and their timelines.',
  usage: 'incidents [--server <path>] [--json]',
  status: 'IMPLEMENTED',
  gate: 3,
  details: [
    'Incidents are recorded when `sentinel compare` finds changes and effects in',
    'the same window. Each carries a timeline, the resources involved, and a',
    'confidence that the observations are related.',
    '',
    'An incident never names a cause. Temporal correlation is evidence of',
    'relatedness, not of causation.',
  ],
  async run(context: CommandContext): Promise<CommandOutcome> {
    const resolved = await resolveScanContext(context);
    const database = openDatabase({ location: resolved.databasePath, logger: context.logger });

    try {
      const server = database.driver
        .prepare('SELECT id FROM servers WHERE path = ?')
        .get<{ id: string }>(resolved.serverPath);

      if (server === undefined) {
        throw new SentinelUserError('This server has not been scanned yet.', {
          remediation: 'Scan it first:\n  sentinel scan',
        });
      }

      const incidents = listIncidents(database.driver, server.id);

      if (incidents.length === 0) {
        return {
          exitCode: EXIT_CODES.SUCCESS,
          text: [
            'No incidents have been recorded for this server.',
            '',
            'Incidents are created when two baselines are compared and changes and',
            'effects appear in the same window:',
            '  sentinel baseline create before',
            '  sentinel baseline create after',
            '  sentinel compare before after',
          ].join('\n'),
          data: { incidents: [] },
        };
      }

      const lines: string[] = [`${String(incidents.length)} incident(s):`, ''];

      for (const incident of incidents) {
        lines.push(
          formatTable([
            ['Incident', incident.id],
            ['Severity', incident.severity],
            ['Confidence', incident.confidence.toFixed(2)],
            ['Window', `${incident.startedAt}${incident.endedAt === null ? '' : ` to ${incident.endedAt}`}`],
            ['Affected', incident.affectedResources.join(', ') || 'server-wide'],
          ]),
          '',
          `  ${incident.summary}`,
          '',
          '  Timeline:',
        );
        for (const event of incident.events) {
          lines.push(
            `    ${event.occurredAt}  ${event.type.padEnd(22)} ${event.resource ?? '-'}  ${event.description}`,
          );
        }
        lines.push('');
      }

      return { exitCode: EXIT_CODES.SUCCESS, text: lines.join('\n').trimEnd(), data: { incidents } };
    } finally {
      database.close();
    }
  },
};
