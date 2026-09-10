/**
 * Call and reference extraction.
 *
 * Recognises the shapes that matter to the diagnostic rules: a called name
 * (`Wait`), a dotted or colon call (`Citizen.Wait`, `MySQL.Async.fetchAll`,
 * `exports.oxmysql:execute`), and the literal arguments passed to it.
 *
 * Only literal arguments are extracted. An argument that is a variable or an
 * expression yields nothing, because reporting a guessed value would be worse
 * than reporting none.
 */

import type { LuaToken } from './lexer.js';

export interface LuaCall {
  /** Full dotted/colon name as written, e.g. `Citizen.Wait`. */
  readonly name: string;
  /** Final segment of the name, e.g. `Wait`. */
  readonly method: string;
  /** Token index of the first token of the call name. */
  readonly startIndex: number;
  /** Token index of the closing parenthesis, or of the last argument token. */
  readonly endIndex: number;
  readonly line: number;
  readonly column: number;
  /** String literal arguments, in order. Non-literal arguments are skipped. */
  readonly stringArguments: readonly string[];
  /** Numeric literal arguments, in order. */
  readonly numberArguments: readonly number[];
  /** True when any argument was not a literal. */
  readonly hasNonLiteralArguments: boolean;
  /**
   * True when the call is written with parentheses. Lua also allows
   * `f 'string'` and `f { table }`, which are used heavily in manifests.
   */
  readonly parenthesised: boolean;
}

/** Reads a dotted/colon-qualified name starting at `start`, or `null`. */
function readQualifiedName(
  tokens: readonly LuaToken[],
  start: number,
): { name: string; endIndex: number } | null {
  const first = tokens[start];
  if (first?.type !== 'NAME') return null;

  let name = first.value;
  let index = start + 1;

  for (;;) {
    const separator = tokens[index];
    const next = tokens[index + 1];
    if (separator === undefined || next === undefined) break;
    const isSeparator = separator.type === 'PUNCTUATION' && (separator.value === '.' || separator.value === ':');
    if (!isSeparator || next.type !== 'NAME') break;
    name += `${separator.value}${next.value}`;
    index += 2;
  }

  return { name, endIndex: index - 1 };
}

/**
 * Extracts every call-like construct from a token stream.
 *
 * The scan is linear and allocation-light: a resource can contain thousands of
 * files, so per-call regular expressions or repeated slicing would dominate the
 * cost of a scan.
 */
export function extractCalls(tokens: readonly LuaToken[]): LuaCall[] {
  const calls: LuaCall[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token?.type !== 'NAME') continue;

    // Skip a name that is itself part of a qualified name being read later.
    const previous = tokens[index - 1];
    if (previous?.type === 'PUNCTUATION' && (previous.value === '.' || previous.value === ':')) continue;

    const qualified = readQualifiedName(tokens, index);
    if (qualified === null) continue;

    const next = tokens[qualified.endIndex + 1];
    if (next === undefined) continue;

    const parenthesised = next.type === 'PUNCTUATION' && next.value === '(';
    const sugared = next.type === 'STRING' || (next.type === 'PUNCTUATION' && next.value === '{');
    if (!parenthesised && !sugared) continue;

    const stringArguments: string[] = [];
    const numberArguments: number[] = [];
    let hasNonLiteralArguments = false;
    let endIndex: number;

    if (parenthesised) {
      let depth = 0;
      let cursor = qualified.endIndex + 1;
      for (; cursor < tokens.length; cursor += 1) {
        const argument = tokens[cursor];
        if (argument === undefined) break;
        if (argument.type === 'PUNCTUATION' && ['(', '{', '['].includes(argument.value)) {
          depth += 1;
          continue;
        }
        if (argument.type === 'PUNCTUATION' && [')', '}', ']'].includes(argument.value)) {
          depth -= 1;
          if (depth === 0) break;
          continue;
        }
        if (depth !== 1) continue;
        if (argument.type === 'STRING') {
          stringArguments.push(argument.value);
          continue;
        }
        if (argument.type === 'NUMBER') {
          // A leading `-` lexes as its own operator token. In argument position
          // it is a sign, not a subtraction — and the distinction matters:
          // `TriggerClientEvent(event, -1, …)` addresses every connected client.
          const previous = tokens[cursor - 1];
          const beforePrevious = tokens[cursor - 2];
          const negated =
            previous?.type === 'OPERATOR' &&
            previous.value === '-' &&
            (beforePrevious === undefined ||
              (beforePrevious.type === 'PUNCTUATION' &&
                (beforePrevious.value === '(' || beforePrevious.value === ',')));
          const parsed = Number(argument.value);
          if (Number.isFinite(parsed)) numberArguments.push(negated ? -parsed : parsed);
          continue;
        }
        if (argument.type === 'PUNCTUATION' && argument.value === ',') continue;
        // A sign belonging to the number that follows is not an unknown argument.
        if (argument.type === 'OPERATOR' && argument.value === '-' && tokens[cursor + 1]?.type === 'NUMBER') continue;
        hasNonLiteralArguments = true;
      }
      endIndex = Math.min(cursor, tokens.length - 1);
    } else if (next.type === 'STRING') {
      stringArguments.push(next.value);
      endIndex = qualified.endIndex + 1;
    } else {
      hasNonLiteralArguments = true;
      endIndex = qualified.endIndex + 1;
    }

    calls.push({
      name: qualified.name,
      method: qualified.name.split(/[.:]/).pop() ?? qualified.name,
      startIndex: index,
      endIndex,
      line: token.line,
      column: token.column,
      stringArguments,
      numberArguments,
      hasNonLiteralArguments,
      parenthesised,
    });

    index = qualified.endIndex;
  }

  return calls;
}

/** Calls whose start index falls inside `[start, end)`. */
export function callsWithin(calls: readonly LuaCall[], start: number, end: number): LuaCall[] {
  return calls.filter((call) => call.startIndex >= start && call.startIndex < end);
}
