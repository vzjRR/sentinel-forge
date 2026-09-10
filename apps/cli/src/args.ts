/**
 * Argument parsing.
 *
 * Written by hand rather than delegated to a parser library: the CLI is a
 * stable automation contract, and hand-parsing keeps the accepted grammar
 * explicit, dependency-free and identical across releases.
 *
 * Grammar:
 *   sentinel [command] [subcommand...] [positional...] [--flag] [--option value]
 *
 * Rules:
 *   - `--option=value` and `--option value` are equivalent.
 *   - Unknown options are an error, never ignored: a typo in a scripted
 *     invocation must not silently change behaviour.
 *   - Everything after `--` is treated as a positional argument.
 */

import { SentinelUserError } from '@sentinel-forge/core';
import { isReportFormat, type ReportFormat } from '@sentinel-forge/shared';

export interface GlobalOptions {
  /** Emit machine-readable JSON on stdout instead of human-readable text. */
  readonly json: boolean;
  /** Suppress log output; results are still written to stdout. */
  readonly quiet: boolean;
  /** Raise log verbosity to DEBUG. */
  readonly verbose: boolean;
  readonly server?: string;
  readonly output?: string;
  readonly format?: ReportFormat;
  readonly config?: string;
  readonly database?: string;
  readonly help: boolean;
  readonly version: boolean;
  /**
   * Carry out an operation that would otherwise only report what it would do.
   * Destructive commands run as a dry run without it.
   */
  readonly confirm: boolean;
}

export interface ParsedArgs {
  /** First non-option argument, or `null` when none was supplied. */
  readonly command: string | null;
  /** Remaining non-option arguments, in order. */
  readonly positionals: readonly string[];
  readonly options: GlobalOptions;
}

interface OptionSpec {
  readonly name: keyof GlobalOptions;
  readonly aliases: readonly string[];
  readonly takesValue: boolean;
  readonly valueName?: string;
  readonly description: string;
}

export const OPTION_SPECS: readonly OptionSpec[] = Object.freeze([
  { name: 'json', aliases: ['--json'], takesValue: false, description: 'Write machine-readable JSON to stdout.' },
  { name: 'quiet', aliases: ['--quiet', '-q'], takesValue: false, description: 'Suppress log output.' },
  { name: 'verbose', aliases: ['--verbose'], takesValue: false, description: 'Enable debug logging.' },
  {
    name: 'server',
    aliases: ['--server'],
    takesValue: true,
    valueName: 'path',
    description: 'Path to the FiveM server root.',
  },
  {
    name: 'output',
    aliases: ['--output', '-o'],
    takesValue: true,
    valueName: 'path',
    description: 'Write command output to a file instead of stdout.',
  },
  {
    name: 'format',
    aliases: ['--format'],
    takesValue: true,
    valueName: 'json|markdown|html',
    description: 'Report output format.',
  },
  {
    name: 'config',
    aliases: ['--config'],
    takesValue: true,
    valueName: 'path',
    description: 'Path to sentinel.config.json.',
  },
  {
    name: 'database',
    aliases: ['--database'],
    takesValue: true,
    valueName: 'path',
    description: 'Path to the local SQLite database.',
  },
  {
    name: 'confirm',
    aliases: ['--confirm'],
    takesValue: false,
    description: 'Carry out a destructive operation. Without it, such commands only report what they would do.',
  },
  { name: 'help', aliases: ['--help', '-h'], takesValue: false, description: 'Show help for a command.' },
  { name: 'version', aliases: ['--version', '-V'], takesValue: false, description: 'Print the product version.' },
]);

const BY_ALIAS = new Map<string, OptionSpec>(
  OPTION_SPECS.flatMap((spec) => spec.aliases.map((alias) => [alias, spec] as const)),
);

/**
 * Parses `argv` (without the node executable and script path).
 *
 * @throws {SentinelUserError} on an unknown option or a missing option value.
 */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};
  let passthrough = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) continue;

    if (passthrough || !token.startsWith('-') || token === '-') {
      positionals.push(token);
      continue;
    }

    if (token === '--') {
      passthrough = true;
      continue;
    }

    const separatorIndex = token.indexOf('=');
    const name = separatorIndex === -1 ? token : token.slice(0, separatorIndex);
    const inlineValue = separatorIndex === -1 ? undefined : token.slice(separatorIndex + 1);

    const spec = BY_ALIAS.get(name);
    if (spec === undefined) {
      throw new SentinelUserError(`Unknown option: ${name}`, {
        remediation: 'Run `sentinel help` to see the supported options.',
      });
    }

    if (!spec.takesValue) {
      if (inlineValue !== undefined) {
        throw new SentinelUserError(`Option ${name} does not take a value.`);
      }
      flags[spec.name] = true;
      continue;
    }

    const value = inlineValue ?? argv[index + 1];
    if (value === undefined || (inlineValue === undefined && value.startsWith('-'))) {
      throw new SentinelUserError(`Option ${name} requires a value.`, {
        remediation: `Example: sentinel scan ${name} <${spec.valueName ?? 'value'}>`,
      });
    }
    if (inlineValue === undefined) index += 1;
    flags[spec.name] = value;
  }

  const format = flags['format'];
  if (typeof format === 'string' && !isReportFormat(format)) {
    throw new SentinelUserError(`Unsupported --format value: ${format}`, {
      remediation: 'Supported formats are: json, markdown, html.',
    });
  }

  const options: GlobalOptions = {
    json: flags['json'] === true,
    quiet: flags['quiet'] === true,
    verbose: flags['verbose'] === true,
    help: flags['help'] === true,
    version: flags['version'] === true,
    confirm: flags['confirm'] === true,
    ...(typeof flags['server'] === 'string' ? { server: flags['server'] } : {}),
    ...(typeof flags['output'] === 'string' ? { output: flags['output'] } : {}),
    ...(typeof format === 'string' && isReportFormat(format) ? { format } : {}),
    ...(typeof flags['config'] === 'string' ? { config: flags['config'] } : {}),
    ...(typeof flags['database'] === 'string' ? { database: flags['database'] } : {}),
  };

  const [command, ...rest] = positionals;

  return {
    command: command ?? null,
    positionals: rest,
    options,
  };
}
