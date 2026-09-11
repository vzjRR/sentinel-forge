/**
 * `sentinel mcp` — serve the read-only MCP interface over stdio.
 *
 * An MCP client launches this as a subprocess and speaks JSON-RPC to it. The
 * transport reserves stdout entirely: the specification says the server **MUST
 * NOT** write anything to stdout that is not a valid MCP message, so this
 * command writes nothing there and every log line goes to stderr, which the
 * specification explicitly permits.
 *
 * The interface is read-only. It returns what Sentinel Forge has already
 * analysed and recorded. An interface that both diagnoses a server and can
 * change it is a tool that breaks a live server on a mistaken inference.
 */

import { resolveConfiguredPath, SentinelUserError } from '@sentinel-forge/core';
import { AnalysisContext } from '@sentinel-forge/engine';
import { EXIT_CODES } from '@sentinel-forge/shared';
import { serveStdio } from '@sentinel-forge/mcp';
import type { CommandOutcome } from '../output.js';
import { resolveScanContext } from '../scan-context.js';
import type { CommandContext, CommandDefinition } from './types.js';

/**
 * How long a scan stays current, in seconds.
 *
 * Five minutes, like the dashboard. An assistant asking three questions in a
 * row should not cause three scans, and one asking a question an hour later
 * should not be answered from an hour-old scan.
 */
export const DEFAULT_MCP_REFRESH_SECONDS = 300;

export const mcpCommand: CommandDefinition = {
  name: 'mcp',
  summary: 'Serve the read-only MCP interface on stdin/stdout.',
  usage: 'mcp [--server <path>] [--refresh <seconds>]',
  status: 'IMPLEMENTED',
  gate: 7,
  details: [
    'Speaks the Model Context Protocol over stdio, so an MCP client can launch',
    'this command as a subprocess and read a diagnosis from it. It runs until',
    'the client closes its input.',
    '',
    'Ten tools, all read-only: sentinel_scan, sentinel_health,',
    'sentinel_resource, sentinel_dependencies, sentinel_performance,',
    'sentinel_compare, sentinel_security, sentinel_integrity,',
    'sentinel_incidents, sentinel_report.',
    '',
    'Nothing here can modify the FiveM server, execute anything, change',
    'configuration, or reach the network. Every result carries the limitations',
    'that apply to it, so an assistant explaining a finding has what it needs',
    'to avoid presenting an observation as a proof.',
    '',
    'stdout carries protocol messages only. Logs go to stderr, so --json is',
    'refused: it would write to a stream the protocol reserves.',
    '',
    'Example client configuration:',
    '  { "command": "sentinel", "args": ["mcp", "--server", "/opt/fxserver"] }',
  ],
  async run(context: CommandContext): Promise<CommandOutcome> {
    if (context.options.json) {
      throw new SentinelUserError('`sentinel mcp` cannot be combined with --json.', {
        remediation:
          'The MCP stdio transport reserves stdout for protocol messages, and a JSON\n' +
          'result written there would corrupt the session. Run it without --json.',
      });
    }

    const resolved = await resolveScanContext(context);
    const refreshSeconds = context.options.refresh ?? DEFAULT_MCP_REFRESH_SECONDS;

    const analysis = new AnalysisContext({
      loaded: resolved.loaded,
      serverPath: resolved.serverPath,
      databasePath: resolveConfiguredPath(resolved.loaded, resolved.databasePath),
      clock: context.clock,
      logger: context.logger,
      refreshIntervalMs: refreshSeconds * 1000,
      command: 'mcp',
    });

    context.logger.info('Serving the read-only MCP interface on stdio.', {
      server: resolved.serverPath,
      refreshSeconds,
    });

    const running = serveStdio({
      context: { analysis, logger: context.logger },
      stdin: process.stdin,
      stdout: process.stdout,
    });

    // Resolves when the client closes stdin, which is how the specification
    // says a stdio server is shut down.
    await running.done;

    context.logger.info('MCP client disconnected.');

    // Deliberately empty: anything written to stdout that is not a protocol
    // message would violate the transport, and the client is gone by now anyway.
    return { exitCode: EXIT_CODES.SUCCESS, text: '', data: {} };
  },
};
