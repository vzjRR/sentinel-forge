/**
 * `server.cfg` parsing.
 *
 * The server configuration is a console-command script: one command per line,
 * with quoted arguments. Sentinel Forge reads the subset that affects a
 * diagnosis — which resources are started, which variables are set, and which
 * further files are executed.
 *
 * Command semantics verified against
 * https://docs.fivem.net/docs/server-manual/server-commands/
 */

export type ResourceCommand = 'ensure' | 'start' | 'stop' | 'restart';

export interface ResourceDirective {
  readonly command: ResourceCommand;
  /** The argument as written. May name a resource or a `[category]`. */
  readonly target: string;
  /**
   * True when the target is a bracketed category name. `start`, `stop`,
   * `ensure` and `restart` all accept a category, which affects every resource
   * inside it — so a category must never be reported as a missing resource.
   */
  readonly isCategory: boolean;
  readonly line: number;
}

export interface ConfigVariable {
  /** `set`, `sets` or `setr`. */
  readonly command: string;
  readonly name: string;
  readonly value: string;
  readonly line: number;
}

export interface ExecDirective {
  readonly target: string;
  readonly line: number;
}

export interface ParsedServerConfig {
  readonly resourceDirectives: readonly ResourceDirective[];
  readonly variables: readonly ConfigVariable[];
  readonly execs: readonly ExecDirective[];
  /** Number of recognised command lines, for reporting what the file contains. */
  readonly commandCount: number;
}

const RESOURCE_COMMANDS = new Set<string>(['ensure', 'start', 'stop', 'restart']);
const VARIABLE_COMMANDS = new Set(['set', 'sets', 'setr']);

/**
 * Splits a configuration line into arguments, honouring double and single
 * quotes. `#` and `//` begin a comment that runs to end of line.
 */
export function tokenizeConfigLine(line: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: string | null = null;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index] ?? '';

    if (quote !== null) {
      if (character === quote) {
        quote = null;
        continue;
      }
      current += character;
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }

    if (character === '#' || (character === '/' && line[index + 1] === '/')) {
      break;
    }

    if (character === ' ' || character === '\t') {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += character;
  }

  if (current.length > 0) tokens.push(current);
  return tokens;
}

export function isCategoryName(target: string): boolean {
  return target.startsWith('[') && target.endsWith(']');
}

export function parseServerConfig(source: string): ParsedServerConfig {
  const resourceDirectives: ResourceDirective[] = [];
  const variables: ConfigVariable[] = [];
  const execs: ExecDirective[] = [];
  let commandCount = 0;

  for (const [offset, rawLine] of source.split(/\r?\n/).entries()) {
    const line = offset + 1;
    const tokens = tokenizeConfigLine(rawLine);
    const command = tokens[0]?.toLowerCase();
    if (command === undefined) continue;

    commandCount += 1;

    if (RESOURCE_COMMANDS.has(command)) {
      const target = tokens[1];
      if (target === undefined) continue;
      resourceDirectives.push({
        command: command as ResourceCommand,
        target,
        isCategory: isCategoryName(target),
        line,
      });
      continue;
    }

    if (VARIABLE_COMMANDS.has(command)) {
      const name = tokens[1];
      if (name === undefined) continue;
      variables.push({ command, name, value: tokens.slice(2).join(' '), line });
      continue;
    }

    if (command === 'exec') {
      const target = tokens[1];
      if (target !== undefined) execs.push({ target, line });
    }
  }

  return { resourceDirectives, variables, execs, commandCount };
}

/**
 * Resources the configuration starts, in declaration order and de-duplicated.
 * A `stop` after an `ensure` removes the entry, mirroring how the commands run.
 */
export function resolveStartedResources(config: ParsedServerConfig): string[] {
  const started = new Map<string, true>();
  for (const directive of config.resourceDirectives) {
    if (directive.isCategory) continue;
    if (directive.command === 'stop') {
      started.delete(directive.target);
      continue;
    }
    started.set(directive.target, true);
  }
  return [...started.keys()];
}
