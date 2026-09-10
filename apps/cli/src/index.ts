/**
 * @sentinel-forge/cli — programmatic entry point.
 *
 * Exported so integration tests and future tooling can invoke commands
 * in-process, with injected streams, instead of spawning a subprocess.
 */

export { run, type RunOptions } from './run.js';
export { parseArgs, type GlobalOptions, type ParsedArgs } from './args.js';
export { listCommands, findCommand } from './commands/index.js';
export type { CommandDefinition, CommandContext, CommandStatus } from './commands/types.js';
