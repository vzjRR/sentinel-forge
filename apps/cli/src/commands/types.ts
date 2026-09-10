/**
 * Command contracts.
 *
 * Every command declares its delivery status honestly. A command listed in the
 * product specification but not yet built reports that fact and exits with a
 * documented code; it never returns an empty or invented result.
 */

import type { Clock, Logger } from '@sentinel-forge/core';
import type { Writable } from 'node:stream';
import type { GlobalOptions } from '../args.js';
import type { CommandOutcome } from '../output.js';

export interface CommandContext {
  readonly options: GlobalOptions;
  /** Positional arguments after the command name. */
  readonly positionals: readonly string[];
  readonly logger: Logger;
  readonly clock: Clock;
  readonly cwd: string;
  readonly stdout: Writable;
}

export type CommandStatus = 'IMPLEMENTED' | 'NOT_IMPLEMENTED';

export interface CommandDefinition {
  readonly name: string;
  /** One-line summary shown by `sentinel help`. */
  readonly summary: string;
  /** Usage line, without the `sentinel` prefix. */
  readonly usage: string;
  readonly status: CommandStatus;
  /** Gate that delivers (or delivered) this command. See docs/GATE_STATUS.md. */
  readonly gate: number;
  /** Longer description shown by `sentinel help <command>`. */
  readonly details?: readonly string[];
  run(context: CommandContext): Promise<CommandOutcome>;
}
