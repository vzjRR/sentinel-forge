/**
 * CLI entry point.
 *
 * Responsibilities, in order: parse arguments, build a logger, dispatch to a
 * command, and translate any outcome — including failures — into a documented
 * exit code and a single well-formed piece of output.
 *
 * The function returns an exit code rather than calling `process.exit`, so the
 * whole CLI is testable in-process.
 */

import type { Writable } from 'node:stream';
import { createLogger, isSentinelError, systemClock, toSentinelError, type Clock, type Logger } from '@sentinel-forge/core';
import { EXIT_CODES, type ExitCode } from '@sentinel-forge/shared';
import { parseArgs, type GlobalOptions } from './args.js';
import { findCommand, suggestCommand } from './commands/index.js';
import { helpCommand } from './commands/help.js';
import { versionCommand } from './commands/version.js';
import { writeError, writeOutcome } from './output.js';
import type { CommandContext } from './commands/types.js';

export interface RunOptions {
  readonly argv: readonly string[];
  readonly cwd?: string;
  readonly stdout?: Writable;
  readonly stderr?: Writable;
  readonly clock?: Clock;
}

function createRunLogger(options: GlobalOptions, stderr: Writable): Logger {
  const level = options.quiet ? 'SILENT' : options.verbose ? 'DEBUG' : 'INFO';
  // Under --json, logs use JSON too so a consumer capturing both streams gets
  // one parseable format rather than two.
  return createLogger({ level, format: options.json ? 'json' : 'pretty', stream: stderr });
}

export async function run(options: RunOptions): Promise<ExitCode> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const cwd = options.cwd ?? process.cwd();
  const clock = options.clock ?? systemClock;

  let commandName = '';
  let json = false;

  try {
    const parsed = parseArgs(options.argv);
    json = parsed.options.json;

    // `--version` and `--help` are shorthands for the corresponding commands.
    const resolvedName =
      parsed.options.version && parsed.command === null
        ? 'version'
        : parsed.command === null || parsed.options.help
          ? 'help'
          : parsed.command;

    // `sentinel <command> --help` shows that command's help, not the overview.
    const positionals =
      parsed.options.help && parsed.command !== null ? [parsed.command, ...parsed.positionals] : parsed.positionals;

    commandName = resolvedName;

    const command =
      resolvedName === 'help' ? helpCommand : resolvedName === 'version' ? versionCommand : findCommand(resolvedName);

    if (command === undefined) {
      const suggestion = suggestCommand(resolvedName);
      const message = `Unknown command: ${resolvedName}`;
      writeError(
        {
          errorId: 'SF-CLI-UNKNOWN',
          category: 'USER',
          message,
          exitCode: EXIT_CODES.INVALID_INPUT,
          remediation:
            suggestion === undefined
              ? 'Run `sentinel help` to see the available commands.'
              : `Did you mean \`sentinel ${suggestion}\`? Run \`sentinel help\` for the full list.`,
        },
        { json, command: resolvedName, stdout, stderr },
      );
      return EXIT_CODES.INVALID_INPUT;
    }

    const logger = createRunLogger(parsed.options, stderr);
    const context: CommandContext = {
      options: parsed.options,
      positionals,
      logger,
      clock,
      cwd,
      stdout,
    };

    logger.debug('Running command.', { command: command.name, status: command.status });

    const outcome = await command.run(context);
    writeOutcome(outcome, { json, command: command.name, stdout });
    return outcome.exitCode;
  } catch (error) {
    const sentinelError = toSentinelError(error);
    writeError(
      {
        errorId: sentinelError.errorId,
        category: sentinelError.category,
        message: sentinelError.message,
        exitCode: sentinelError.exitCode,
        ...(sentinelError.remediation === undefined ? {} : { remediation: sentinelError.remediation }),
        ...(sentinelError.details === undefined ? {} : { details: { ...sentinelError.details } }),
      },
      { json, command: commandName, stdout, stderr },
    );

    if (!isSentinelError(error)) {
      // Unexpected failures keep their stack available under --verbose only,
      // since a stack can contain paths the operator may not want to share.
      if (options.argv.includes('--verbose') && error instanceof Error) {
        stderr.write(`${error.stack ?? error.message}\n`);
      }
    }

    return sentinelError.exitCode;
  }
}
