/**
 * Remote loading and dynamic execution indicators.
 *
 * Two related but distinct observations:
 *
 *   - **Remote load**: content is fetched at runtime and passed to a code
 *     loader. What runs then cannot be determined from the files on disk, so no
 *     review of the resource covers it.
 *   - **Dynamic execution**: a string is executed as code. That is a normal
 *     technique in some resources, so it is reported at lower severity, and only
 *     when the input is not a literal.
 *
 * Both are indicators. Neither establishes that anything malicious happens.
 */

import { extractCalls, lexLua, type LuaCall } from '@sentinel-forge/lua';

/** Calls that fetch content over the network. */
export const FETCH_CALLS: ReadonlySet<string> = new Set([
  'PerformHttpRequest',
  'Citizen.InvokeNative',
  'exports.http:request',
  'http.request',
  'fetch',
]);

/** Calls that execute a string as code. */
export const LOAD_CALLS: ReadonlySet<string> = new Set(['load', 'loadstring', 'RunString', 'dofile', 'require']);

/** Calls that write files to disk from inside a resource. */
export const FILE_WRITE_CALLS: ReadonlySet<string> = new Set(['SaveResourceFile', 'io.open', 'io.write']);

export interface RemoteLoadIndicator {
  /** The fetch that brought content in. */
  readonly fetchCall: string;
  readonly fetchLine: number;
  /**
   * Loaders reachable from that fetch. Grouped per fetch rather than reported
   * as one indicator per pair: one fetch feeding three loaders is one situation
   * to investigate, not three.
   */
  readonly loaders: readonly { readonly call: string; readonly line: number; readonly distance: number }[];
  /** URL when it was a literal; absent when built at runtime. */
  readonly url?: string;
  /** Distance to the nearest loader, as a proximity signal. */
  readonly distance: number;
}

export interface DynamicExecutionIndicator {
  readonly call: string;
  readonly line: number;
  readonly column: number;
  /** True when the executed value is a literal, which is far less concerning. */
  readonly literalInput: boolean;
}

export interface FileWriteIndicator {
  readonly call: string;
  readonly line: number;
  /** Path when it was a literal. */
  readonly path?: string;
  /** True when the written path looks executable. */
  readonly executableTarget: boolean;
}

export interface ExecutionAnalysis {
  readonly remoteLoads: readonly RemoteLoadIndicator[];
  readonly dynamicExecutions: readonly DynamicExecutionIndicator[];
  readonly fileWrites: readonly FileWriteIndicator[];
}

const EXECUTABLE_EXTENSIONS = /\.(?:exe|dll|so|dylib|bat|cmd|ps1|sh|scr|vbs|jar)$/i;

export function analyzeExecution(content: string): ExecutionAnalysis {
  const { tokens } = lexLua(content);
  const calls = extractCalls(tokens);

  const fetches = calls.filter((call) => FETCH_CALLS.has(call.name));
  const loads = calls.filter((call) => LOAD_CALLS.has(call.name));
  const writes = calls.filter((call) => FILE_WRITE_CALLS.has(call.name));

  const remoteLoads: RemoteLoadIndicator[] = [];
  for (const fetch of fetches) {
    // A loader that runs before the fetch cannot be executing its result, and
    // one far below it is probably unrelated. 60 lines covers a callback body
    // without pairing everything in a large file.
    const reachable = loads
      .map((load) => ({ call: load.name, line: load.line, distance: load.line - fetch.line }))
      .filter((load) => load.distance >= 0 && load.distance <= 60)
      .sort((a, b) => a.distance - b.distance);

    if (reachable.length === 0) continue;

    const url = fetch.stringArguments.find((argument) => /^https?:\/\//i.test(argument));
    remoteLoads.push({
      fetchCall: fetch.name,
      fetchLine: fetch.line,
      loaders: reachable,
      ...(url === undefined ? {} : { url }),
      distance: reachable[0]?.distance ?? 0,
    });
  }

  const dynamicExecutions: DynamicExecutionIndicator[] = loads
    .filter((call) => call.name !== 'require')
    .map((call: LuaCall) => ({
      call: call.name,
      line: call.line,
      column: call.column,
      // `load("return 1")` is a literal and unremarkable; `load(payload)` is not.
      literalInput: call.stringArguments.length > 0 && !call.hasNonLiteralArguments,
    }));

  const fileWrites: FileWriteIndicator[] = writes.map((call) => {
    const target = call.stringArguments.find((argument) => argument.includes('.'));
    return {
      call: call.name,
      line: call.line,
      ...(target === undefined ? {} : { path: target }),
      executableTarget: target !== undefined && EXECUTABLE_EXTENSIONS.test(target),
    };
  });

  return { remoteLoads, dynamicExecutions, fileWrites };
}
