/**
 * `sentinel dashboard` — serve the local, read-only dashboard.
 *
 * The command runs until it is interrupted, which makes it the one command in
 * the product that does not return a result and exit. It therefore prints what
 * it is doing, what it is exposing, and where, before it begins.
 *
 * It binds the loopback interface. Binding anywhere else is possible and
 * requires saying so explicitly, because a dashboard reachable from the network
 * publishes a map of a server's weaknesses to whoever finds the port.
 */

import { resolveConfiguredPath, type Logger } from '@sentinel-forge/core';
import { EXIT_CODES } from '@sentinel-forge/shared';
import { DashboardContext, isLoopbackHost, startDashboard } from '@sentinel-forge/dashboard';
import { formatTable, type CommandOutcome } from '../output.js';
import { resolveScanContext } from '../scan-context.js';
import type { CommandContext, CommandDefinition } from './types.js';

/** Loopback, and a port unlikely to collide with a FiveM server or a proxy. */
export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_PORT = 7878;
/** Five minutes. Long enough that browsing costs nothing, short enough to stay current. */
export const DEFAULT_REFRESH_SECONDS = 300;

/**
 * Waits until the process is interrupted.
 *
 * `SIGINT` and `SIGTERM` both resolve, so Ctrl-C and a service manager both
 * shut the server down through the same path and the port is released.
 */
function waitForShutdown(logger: Logger): Promise<void> {
  return new Promise<void>((resolve) => {
    const stop = (signal: string): void => {
      logger.info('Dashboard shutting down.', { signal });
      process.off('SIGINT', onInterrupt);
      process.off('SIGTERM', onTerminate);
      resolve();
    };
    const onInterrupt = (): void => {
      stop('SIGINT');
    };
    const onTerminate = (): void => {
      stop('SIGTERM');
    };

    process.once('SIGINT', onInterrupt);
    process.once('SIGTERM', onTerminate);
  });
}

export const dashboardCommand: CommandDefinition = {
  name: 'dashboard',
  summary: 'Serve the local, read-only dashboard.',
  usage: 'dashboard [--host <address>] [--port <number>] [--refresh <seconds>] [--server <path>]',
  status: 'IMPLEMENTED',
  gate: 6,
  details: [
    'Serves every page over HTTP on the loopback interface. Runs until you',
    'interrupt it with Ctrl-C.',
    '',
    'The dashboard is read-only. It cannot modify the FiveM server, run a',
    'command against it, or change configuration, and it accepts only GET and',
    'HEAD requests. There is no authentication, which is why it binds to',
    '127.0.0.1 and refuses any other address without --allow-non-loopback.',
    '',
    'Every page is rendered on the server and loads no external resource: no',
    'script, no font, no image, no analytics. Nothing leaves the machine.',
    '',
    '--refresh controls how long a scan stays current. The default is 300',
    'seconds; 0 scans once at startup and shows that scan until you restart.',
    'Every page states when the data it shows was produced.',
  ],
  async run(context: CommandContext): Promise<CommandOutcome> {
    const resolved = await resolveScanContext(context);

    const host = context.options.host ?? DEFAULT_HOST;
    const port = context.options.port ?? DEFAULT_PORT;
    const refreshSeconds = context.options.refresh ?? DEFAULT_REFRESH_SECONDS;
    const displayHost = host.includes(':') ? `[${host}]` : host;

    const dashboardContext = new DashboardContext({
      loaded: resolved.loaded,
      serverPath: resolved.serverPath,
      databasePath: resolveConfiguredPath(resolved.loaded, resolved.databasePath),
      clock: context.clock,
      logger: context.logger,
      refreshIntervalMs: refreshSeconds * 1000,
      boundTo: `${displayHost}:${String(port)}`,
    });

    // The first scan runs before the port opens, so the first page an operator
    // sees is already populated rather than blank while a scan runs.
    context.logger.info('Scanning before the dashboard starts.', { server: resolved.serverPath });
    const first = await dashboardContext.scan();

    const running = await startDashboard({
      context: dashboardContext,
      host,
      port,
      logger: context.logger,
      ...(context.options.allowNonLoopback ? { allowNonLoopback: true } : {}),
    });

    const lines = [
      `Sentinel Forge dashboard is serving ${resolved.serverPath}`,
      '',
      formatTable([
        ['Address', running.url],
        ['Reachable from', isLoopbackHost(host) ? 'this machine only' : 'the network — it has no authentication'],
        ['Server', resolved.serverPath],
        ['Database', dashboardContext.databasePath],
        [
          'Scan refresh',
          refreshSeconds <= 0
            ? 'never — restart to rescan'
            : `at most every ${String(refreshSeconds)} s, on the next request`,
        ],
        ['First scan', `${String(first.result.report.findings.length)} finding(s) in ${String(first.durationMs)} ms`],
      ]),
      '',
      'Read-only: the dashboard cannot modify the server, run a command against it,',
      'or change configuration. It accepts GET and HEAD only.',
      '',
      'Press Ctrl-C to stop.',
    ];

    // Printed before waiting, because the outcome is only written when a
    // command returns and this one does not return until it is interrupted.
    context.stdout.write(`${lines.join('\n')}\n`);

    await waitForShutdown(context.logger);
    await running.close();

    return {
      exitCode: EXIT_CODES.SUCCESS,
      text: 'Dashboard stopped. Nothing belonging to the FiveM server was changed.',
      data: {
        url: running.url,
        host: running.host,
        port: running.port,
        server: resolved.serverPath,
        database: dashboardContext.databasePath,
        refreshSeconds,
      },
    };
  },
};
