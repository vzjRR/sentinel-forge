/**
 * Script analysis model.
 *
 * Turns a Lua source file into the structural facts the diagnostic rules need:
 * loops and their bodies, calls and their literal arguments, thread creation,
 * event usage and database usage.
 *
 * The source is never executed. Everything here is derived from tokens and
 * block structure, which is why each rule built on it documents what it cannot
 * see — a value held in a variable, a function called indirectly, or code
 * generated at runtime.
 */

import {
  analyzeStructure,
  callsWithin,
  enclosingLoop,
  extractCalls,
  isContinuousCondition,
  lexLua,
  type Loop,
  type LuaCall,
  type LuaToken,
} from '@sentinel-forge/lua';

export type ScriptSide = 'client' | 'server' | 'shared' | 'unknown';

/** Calls that yield the current thread back to the scheduler. */
export const YIELDING_CALLS: ReadonlySet<string> = new Set([
  'Wait',
  'Citizen.Wait',
  'Citizen.Await',
  'coroutine.yield',
  'Sleep',
]);

/** Calls that create a background thread. */
export const THREAD_CALLS: ReadonlySet<string> = new Set([
  'CreateThread',
  'Citizen.CreateThread',
  'Citizen.CreateThreadNow',
  'SetTimeout',
  'Citizen.SetTimeout',
]);

/** Event registration primitives. */
export const EVENT_REGISTRATION_CALLS: ReadonlySet<string> = new Set([
  'RegisterNetEvent',
  'AddEventHandler',
  'RegisterServerEvent',
  'RegisterCommand',
]);

/** Event trigger primitives, mapped to the direction they send in. */
export const EVENT_TRIGGER_CALLS: Readonly<Record<string, 'to-server' | 'to-client' | 'local'>> = Object.freeze({
  TriggerServerEvent: 'to-server',
  TriggerClientEvent: 'to-client',
  TriggerEvent: 'local',
  TriggerLatentServerEvent: 'to-server',
  TriggerLatentClientEvent: 'to-client',
});

export interface LoopFact {
  readonly loop: Loop;
  /** True when the condition can never end the loop (`while true`). */
  readonly continuous: boolean;
  /** True when a yielding call appears anywhere in the body. */
  readonly yields: boolean;
  /**
   * Shortest literal wait interval in milliseconds found in the body, when the
   * argument was a literal. `undefined` when no literal interval was found.
   */
  readonly waitMs?: number;
  /** Calls in the body that this analysis cannot follow into. */
  readonly opaqueCallCount: number;
  /** True when the loop is the body of a created thread. */
  readonly insideThread: boolean;
}

export interface EventFact {
  readonly kind: 'REGISTRATION' | 'TRIGGER';
  readonly call: string;
  /** Event name when it was a string literal; `undefined` when computed. */
  readonly event?: string;
  readonly direction?: 'to-server' | 'to-client' | 'local';
  readonly line: number;
  readonly column: number;
  /** True when the trigger sends to every client (`TriggerClientEvent(..., -1, …)`). */
  readonly broadcast?: boolean;
  /** Innermost enclosing loop, when the usage is inside one. */
  readonly loop?: LoopFact;
}

export interface QueryFact {
  readonly call: string;
  /** SQL when it was a string literal; `undefined` when built at runtime. */
  readonly sql?: string;
  readonly line: number;
  readonly column: number;
  /** True when the statement text is assembled with `..` inside the call. */
  readonly concatenated: boolean;
  readonly selectsEveryColumn: boolean;
  readonly hasWhere: boolean;
  readonly hasLimit: boolean;
  readonly isSelect: boolean;
  readonly loop?: LoopFact;
}

export interface ScriptAnalysis {
  /** Server-relative POSIX path. */
  readonly filePath: string;
  readonly resource: string;
  readonly side: ScriptSide;
  readonly tokens: readonly LuaToken[];
  readonly calls: readonly LuaCall[];
  readonly loops: readonly LoopFact[];
  readonly events: readonly EventFact[];
  readonly queries: readonly QueryFact[];
  /** True when block delimiters did not balance; ranges are approximate. */
  readonly unbalanced: boolean;
  /** True when the token budget was reached and analysis is incomplete. */
  readonly truncated: boolean;
  readonly lineCount: number;
}

/** Names whose call is understood, so a body containing only these is fully analysed. */
const KNOWN_BENIGN_CALLS = new Set([
  ...YIELDING_CALLS,
  ...THREAD_CALLS,
  ...EVENT_REGISTRATION_CALLS,
  ...Object.keys(EVENT_TRIGGER_CALLS),
  'print',
  'pairs',
  'ipairs',
  'tostring',
  'tonumber',
  'type',
  'math.floor',
  'math.ceil',
  'math.random',
  'table.insert',
  'table.remove',
  'string.format',
  'os.time',
]);

export interface AnalyzeScriptOptions {
  readonly filePath: string;
  readonly resource: string;
  readonly side: ScriptSide;
  readonly maxTokens?: number;
}

export function analyzeScript(source: string, options: AnalyzeScriptOptions): ScriptAnalysis {
  const lexed = lexLua(source, options.maxTokens === undefined ? {} : { maxTokens: options.maxTokens });
  const { tokens } = lexed;
  const structure = analyzeStructure(tokens);
  const calls = extractCalls(tokens);

  const threadBodies = collectThreadBodies(tokens, calls);

  const loops: LoopFact[] = structure.loops.map((loop) => {
    const inBody = callsWithin(calls, loop.bodyStart, loop.bodyEnd);
    const yieldingCalls = inBody.filter((call) => YIELDING_CALLS.has(call.name));
    const waits = yieldingCalls.flatMap((call) => call.numberArguments);

    return {
      loop,
      continuous: isContinuousCondition(loop.kind, loop.conditionTokens),
      yields: yieldingCalls.length > 0,
      ...(waits.length > 0 ? { waitMs: Math.min(...waits) } : {}),
      opaqueCallCount: inBody.filter((call) => !KNOWN_BENIGN_CALLS.has(call.name)).length,
      insideThread: threadBodies.some((range) => loop.keywordIndex > range.start && loop.keywordIndex < range.end),
    };
  });

  const loopFor = (tokenIndex: number): LoopFact | undefined => {
    const loop = enclosingLoop(structure.loops, tokenIndex);
    return loop === undefined ? undefined : loops.find((fact) => fact.loop.keywordIndex === loop.keywordIndex);
  };

  const events: EventFact[] = [];
  for (const call of calls) {
    if (EVENT_REGISTRATION_CALLS.has(call.name)) {
      const loop = loopFor(call.startIndex);
      events.push({
        kind: 'REGISTRATION',
        call: call.name,
        ...(call.stringArguments[0] === undefined ? {} : { event: call.stringArguments[0] }),
        line: call.line,
        column: call.column,
        ...(loop === undefined ? {} : { loop }),
      });
      continue;
    }

    const direction = EVENT_TRIGGER_CALLS[call.name];
    if (direction !== undefined) {
      const loop = loopFor(call.startIndex);
      events.push({
        kind: 'TRIGGER',
        call: call.name,
        ...(call.stringArguments[0] === undefined ? {} : { event: call.stringArguments[0] }),
        direction,
        line: call.line,
        column: call.column,
        // `-1` as the target of TriggerClientEvent addresses every player.
        ...(direction === 'to-client' ? { broadcast: call.numberArguments.includes(-1) } : {}),
        ...(loop === undefined ? {} : { loop }),
      });
    }
  }

  const queries = extractQueries(tokens, calls, loopFor);

  return {
    filePath: options.filePath,
    resource: options.resource,
    side: options.side,
    tokens,
    calls,
    loops,
    events,
    queries,
    unbalanced: structure.unbalanced,
    truncated: lexed.truncated,
    lineCount: tokens.length === 0 ? 0 : (tokens[tokens.length - 1]?.line ?? 0),
  };
}

/**
 * Token ranges covered by a thread-creating call, so a loop can be identified as
 * a thread's main loop. The range runs from the call to the matching `end` of
 * the function it was given.
 */
function collectThreadBodies(
  tokens: readonly LuaToken[],
  calls: readonly LuaCall[],
): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];

  for (const call of calls) {
    if (!THREAD_CALLS.has(call.name)) continue;

    // Find the `function` keyword that follows the call name.
    let cursor = call.startIndex;
    let functionIndex = -1;
    for (; cursor < tokens.length && cursor < call.startIndex + 8; cursor += 1) {
      const token = tokens[cursor];
      if (token?.type === 'KEYWORD' && token.value === 'function') {
        functionIndex = cursor;
        break;
      }
    }
    if (functionIndex === -1) continue;

    // Walk to the matching `end`, tracking nested blocks.
    let depth = 0;
    for (let index = functionIndex; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (token?.type !== 'KEYWORD') continue;
      if (token.value === 'function' || token.value === 'do' || token.value === 'then' || token.value === 'repeat') {
        depth += 1;
        continue;
      }
      if (token.value === 'end' || token.value === 'until') {
        depth -= 1;
        if (depth === 0) {
          ranges.push({ start: functionIndex, end: index });
          break;
        }
      }
    }
  }

  return ranges;
}

/** Database call names understood by this build, by framework. */
export const DATABASE_CALL_PREFIXES: readonly string[] = Object.freeze([
  'MySQL.',
  'MySQL:',
  'exports.oxmysql:',
  'exports.ghmattimysql:',
  'exports.mysql-async:',
  'Oxmysql.',
  'oxmysql.',
]);

/** Bare database call names. */
export const DATABASE_CALL_NAMES: ReadonlySet<string> = new Set([
  'MySQL.query',
  'MySQL.execute',
  'MySQL.scalar',
  'MySQL.single',
  'MySQL.insert',
  'MySQL.update',
  'MySQL.prepare',
  'MySQL.transaction',
  'MySQL.rawExecute',
]);

export function isDatabaseCall(name: string): boolean {
  if (DATABASE_CALL_NAMES.has(name)) return true;
  return DATABASE_CALL_PREFIXES.some((prefix) => name.startsWith(prefix));
}

const SELECT_STAR = /\bselect\s+\*/i;
const HAS_WHERE = /\bwhere\b/i;
const HAS_LIMIT = /\blimit\b/i;
const IS_SELECT = /^\s*select\b/i;

function extractQueries(
  tokens: readonly LuaToken[],
  calls: readonly LuaCall[],
  loopFor: (tokenIndex: number) => LoopFact | undefined,
): QueryFact[] {
  const queries: QueryFact[] = [];

  for (const call of calls) {
    if (!isDatabaseCall(call.name)) continue;

    const sql = call.stringArguments.find((argument) => /\b(select|insert|update|delete|replace)\b/i.test(argument));
    const concatenated = hasConcatenationInArguments(tokens, call.startIndex, call.endIndex);
    const loop = loopFor(call.startIndex);

    queries.push({
      call: call.name,
      ...(sql === undefined ? {} : { sql }),
      line: call.line,
      column: call.column,
      concatenated,
      selectsEveryColumn: sql !== undefined && SELECT_STAR.test(sql),
      hasWhere: sql !== undefined && HAS_WHERE.test(sql),
      hasLimit: sql !== undefined && HAS_LIMIT.test(sql),
      isSelect: sql !== undefined && IS_SELECT.test(sql),
      ...(loop === undefined ? {} : { loop }),
    });
  }

  return queries;
}

/** True when a `..` operator appears between the call's parentheses. */
function hasConcatenationInArguments(tokens: readonly LuaToken[], start: number, end: number): boolean {
  for (let index = start; index <= end && index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token?.type === 'OPERATOR' && token.value === '..') return true;
  }
  return false;
}
