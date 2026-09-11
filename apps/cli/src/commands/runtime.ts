/**
 * `sentinel runtime` — telemetry from the in-server collector.
 *
 * Everything this command reports was measured by `sentinel_doctor` inside the
 * running server. Nothing here is derived from static analysis, and nothing is
 * substituted for a measurement the collector could not take.
 *
 * The most important thing it reports is what is *not* measured. FiveM exposes
 * no scripting API for per-resource CPU or tick time, so no per-resource timing
 * exists in any of this output — and that is stated in the output itself rather
 * than left for the operator to discover from a missing column.
 */

import { findServerByPath, openDatabase, SentinelUserError } from '@sentinel-forge/core';
import { EXIT_CODES, RUNTIME_SECTION_LIMITATION } from '@sentinel-forge/shared';
import {
  ingestTelemetry,
  loadRuntimeEvents,
  readStoredRuntimeState,
  readTelemetry,
  summarize,
  COLLECTOR_RESOURCE,
} from '@sentinel-forge/runtime';
import { formatTable, type CommandOutcome } from '../output.js';
import { resolveScanContext, type ResolvedScanContext } from '../scan-context.js';
import type { CommandContext, CommandDefinition } from './types.js';

const SUBCOMMANDS = ['status', 'import', 'events'] as const;

const INSTALL_HINT = [
  `Install the collector to gather runtime data:`,
  `  1. copy resources/${COLLECTOR_RESOURCE} into your server's resources directory`,
  `  2. add \`ensure ${COLLECTOR_RESOURCE}\` to server.cfg and restart the resource`,
  `  3. run \`sentinel runtime import\` once it has been running for a few minutes`,
].join('\n');

/**
 * Reads what the collector has written, without touching the database.
 *
 * Kept separate from ingestion so `status` can describe a server that has never
 * been scanned: the collector's presence on disk is a fact about the server,
 * and it does not depend on Sentinel Forge having a record of it.
 */
async function readFromDisk(context: CommandContext, resolved: ResolvedScanContext) {
  return readTelemetry({
    serverRoot: resolved.serverPath,
    resourceDirectories: resolved.loaded.config.server.resourceDirectories,
    maxFileBytes: resolved.loaded.config.scan.maxFileBytes,
    logger: context.logger,
  });
}

function renderInstallations(
  installations: readonly { relativePath: string; telemetryFiles: readonly unknown[]; hasTelemetryDirectory: boolean }[],
): string[] {
  if (installations.length === 0) {
    return ['Collector: not installed', '', INSTALL_HINT];
  }

  const lines = [`Collector: installed (${String(installations.length)} copy/copies)`, ''];
  for (const installation of installations) {
    lines.push(
      `  ${installation.relativePath}`,
      installation.telemetryFiles.length === 0
        ? '    no telemetry written yet — the collector writes its first file after one flush interval (60s by default)'
        : `    ${String(installation.telemetryFiles.length)} telemetry file(s) on disk`,
    );
  }

  if (installations.length > 1) {
    lines.push(
      '',
      'More than one copy of the collector is installed. Only one should be started;',
      'two running collectors write two sets of files describing the same server.',
    );
  }

  return lines;
}

export const runtimeCommand: CommandDefinition = {
  name: 'runtime',
  summary: 'Import and inspect telemetry measured by the in-server collector.',
  usage: 'runtime <status|import|events> [--server <path>] [--json]',
  status: 'IMPLEMENTED',
  gate: 5,
  details: [
    'status   Report whether the collector is installed, what it has written,',
    '         and what has already been imported. Reads nothing into the database.',
    'import   Read the collector\'s telemetry files into the local database.',
    'events   Show resource state transitions the collector observed.',
    '',
    'Importing is idempotent. The collector writes into a fixed rotation of',
    'files, so the same measurements are on disk across several imports; a',
    'document that has already been imported is skipped rather than counted',
    'twice.',
    '',
    'What is measured: scheduler latency, resource state, resource transitions,',
    'and a player count.',
    '',
    'What is NOT measured: per-resource CPU or tick time. FiveM exposes no',
    'scripting API for it, so Sentinel Forge reports none. A fabricated number',
    'would corrupt every baseline and regression comparison built on it.',
    '',
    'The collector records a player count and nothing else about players. No',
    'identifier, name, endpoint or position is read or stored.',
  ],
  async run(context: CommandContext): Promise<CommandOutcome> {
    const subcommand = context.positionals[0] ?? 'status';
    if (!SUBCOMMANDS.includes(subcommand as (typeof SUBCOMMANDS)[number])) {
      throw new SentinelUserError(`Unknown runtime subcommand: ${subcommand}`, {
        remediation: `Supported subcommands: ${SUBCOMMANDS.join(', ')}.`,
      });
    }

    const resolved = await resolveScanContext(context);

    switch (subcommand) {
      case 'status':
        return status(context, resolved);
      case 'import':
        return runImport(context, resolved);
      default:
        return events(context, resolved);
    }
  },
};

async function status(context: CommandContext, resolved: ResolvedScanContext): Promise<CommandOutcome> {
  const read = await readFromDisk(context, resolved);
  const onDisk = summarize(read);

  const database = openDatabase({ location: resolved.databasePath, logger: context.logger });
  try {
    const server = findServerByPath(database.driver, resolved.serverPath);
    const stored = server === undefined ? undefined : readStoredRuntimeState(database.driver, server.id);

    const lines = [`Runtime telemetry for ${resolved.serverPath}`, '', ...renderInstallations(read.installations), ''];

    if (read.installations.length > 0) {
      lines.push(
        'On disk, not yet imported or already imported:',
        formatTable([
          ['Documents', String(onDisk.documentCount)],
          ['Samples', String(onDisk.sampleCount)],
          ['Events', String(onDisk.eventCount)],
          ['Metrics', onDisk.metrics.length === 0 ? 'none' : onDisk.metrics.join(', ')],
          ['Earliest', onDisk.earliest ?? 'Unavailable'],
          ['Latest', onDisk.latest ?? 'Unavailable'],
        ]),
        '',
      );
    }

    if (server === undefined) {
      lines.push(
        'Imported: nothing. This server has not been scanned yet.',
        '',
        'Scan it once so telemetry can be attached to it:',
        '  sentinel scan',
        '  sentinel runtime import',
        '',
      );
    } else if (stored !== undefined) {
      lines.push(
        'Imported into the local database:',
        formatTable([
          ['Documents', String(stored.documentCount)],
          ['Samples', String(stored.sampleCount)],
          ['Events', String(stored.eventCount)],
          [
            'Dropped by the collector',
            stored.droppedSamples + stored.droppedEvents === 0
              ? 'none'
              : `${String(stored.droppedSamples)} sample(s), ${String(stored.droppedEvents)} event(s) — buffer was full`,
          ],
          ['First import', stored.firstImportedAt ?? 'never'],
          ['Last import', stored.lastImportedAt ?? 'never'],
          ['Collector version', stored.collectorVersions.length === 0 ? 'Unavailable' : stored.collectorVersions.join(', ')],
        ]),
        '',
      );
    }

    if (read.problems.length > 0) {
      lines.push(`${String(read.problems.length)} file(s) could not be read:`, '');
      for (const problem of read.problems) lines.push(`  ${problem.file}: ${problem.reason}`);
      lines.push('');
    }

    lines.push('Limitations:', `  ${RUNTIME_SECTION_LIMITATION}`);

    return {
      exitCode: EXIT_CODES.SUCCESS,
      text: lines.join('\n'),
      data: {
        installations: read.installations.map((installation) => ({
          path: installation.relativePath,
          telemetryFiles: installation.telemetryFiles.length,
          hasTelemetryDirectory: installation.hasTelemetryDirectory,
        })),
        onDisk,
        imported: stored ?? null,
        problems: read.problems,
        limitation: RUNTIME_SECTION_LIMITATION,
      },
    };
  } finally {
    database.close();
  }
}

async function runImport(context: CommandContext, resolved: ResolvedScanContext): Promise<CommandOutcome> {
  const read = await readFromDisk(context, resolved);

  if (read.installations.length === 0) {
    throw new SentinelUserError(`The ${COLLECTOR_RESOURCE} collector is not installed on this server.`, {
      remediation: INSTALL_HINT,
    });
  }

  const database = openDatabase({ location: resolved.databasePath, logger: context.logger });
  try {
    const server = findServerByPath(database.driver, resolved.serverPath);
    if (server === undefined) {
      // The samples belong to a server, and a server is identified by a scan.
      // Registering one here from the path alone would create a record with no
      // inventory and no fingerprint behind it.
      throw new SentinelUserError('This server has not been scanned yet, so telemetry cannot be attached to it.', {
        remediation: 'Scan it once, then import:\n  sentinel scan\n  sentinel runtime import',
      });
    }

    const result = ingestTelemetry(database.driver, read, { serverId: server.id, clock: context.clock });

    const lines = [
      `Imported runtime telemetry for ${resolved.serverPath}`,
      '',
      formatTable([
        ['Documents imported', String(result.imported.length)],
        [
          'Documents skipped',
          result.alreadyImported.length === 0
            ? 'none'
            : `${String(result.alreadyImported.length)} (already imported — the collector rotates file names)`,
        ],
        ['Samples recorded', String(result.samplesWritten)],
        ['Events recorded', String(result.eventsWritten)],
        [
          'Dropped by the collector',
          result.droppedByCollector.samples + result.droppedByCollector.events === 0
            ? 'none'
            : `${String(result.droppedByCollector.samples)} sample(s), ${String(result.droppedByCollector.events)} event(s) — buffer was full`,
        ],
      ]),
      '',
    ];

    if (read.problems.length > 0) {
      lines.push(`${String(read.problems.length)} file(s) could not be read:`, '');
      for (const problem of read.problems) lines.push(`  ${problem.file}: ${problem.reason}`);
      lines.push('');
    }

    if (result.samplesWritten > 0) {
      lines.push(
        'Samples are not attached to a baseline until one is captured. Capture a',
        'baseline to close this measurement window, then compare two windows:',
        '  sentinel baseline create after-change',
        '  sentinel compare before-change after-change',
        '',
      );
    } else if (result.imported.length === 0 && result.alreadyImported.length > 0) {
      lines.push(
        'Nothing new was on disk. The collector writes a file once per flush',
        'interval (60s by default); give it time and import again.',
        '',
      );
    }

    lines.push('Limitations:', `  ${RUNTIME_SECTION_LIMITATION}`);

    return {
      exitCode: EXIT_CODES.SUCCESS,
      text: lines.join('\n'),
      data: {
        imported: result.imported,
        alreadyImported: result.alreadyImported,
        samplesWritten: result.samplesWritten,
        eventsWritten: result.eventsWritten,
        droppedByCollector: result.droppedByCollector,
        problems: read.problems,
        limitation: RUNTIME_SECTION_LIMITATION,
      },
    };
  } finally {
    database.close();
  }
}

/**
 * Reads observed events out of the local database.
 *
 * Returns a promise to match the command contract, though it does no I/O of its
 * own beyond the database: the events were imported by `import`, and showing
 * them must not quietly re-read the server.
 */
function events(context: CommandContext, resolved: ResolvedScanContext): Promise<CommandOutcome> {
  const database = openDatabase({ location: resolved.databasePath, logger: context.logger });
  try {
    const server = findServerByPath(database.driver, resolved.serverPath);
    if (server === undefined) {
      throw new SentinelUserError('This server has not been scanned yet.', {
        remediation: 'Scan it once, then import telemetry:\n  sentinel scan\n  sentinel runtime import',
      });
    }

    const observed = loadRuntimeEvents(database.driver, server.id, 100);

    const lines = [`Runtime events observed on ${resolved.serverPath}`, ''];

    if (observed.length === 0) {
      lines.push(
        'No runtime events have been imported.',
        '',
        'The collector records a resource state transition when one happens, and',
        'sweeps every resource\'s state periodically. Import what it has written:',
        '  sentinel runtime import',
        '',
      );
    } else {
      lines.push(
        formatTable(
          observed.map(
            (event) =>
              [
                event.observedAt,
                `${event.kind}  ${event.resource ?? '(server)'}${event.detail === undefined ? '' : `  → ${event.detail}`}${
                  event.playerCount === undefined ? '' : `  [${String(event.playerCount)} player(s)]`
                }`,
              ] as const,
          ),
        ),
        '',
        `${String(observed.length)} event(s), newest first.`,
        '',
      );
    }

    lines.push(
      'Limitations:',
      '  These are observations, not conclusions. A resource stopping is recorded',
      '  as a resource stopping; why it stopped is not something the collector can',
      '  see, and is not inferred here.',
    );

    return Promise.resolve({
      exitCode: EXIT_CODES.SUCCESS,
      text: lines.join('\n'),
      data: { events: observed },
    });
  } finally {
    database.close();
  }
}
