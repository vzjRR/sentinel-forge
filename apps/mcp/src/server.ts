/**
 * The MCP server: dispatch and the stdio transport.
 *
 * The whole surface is read-only. There is no tool that writes, no tool that
 * executes, and no tool that reaches the network — and that is a property of
 * what is registered, not of what each handler happens to do.
 *
 * An interface that both diagnoses a server and can change it is a tool that
 * breaks a live server on a mistaken inference. The boundary is the design.
 *
 * © 2026 Talal Al Ghafri. All Rights Reserved.
 */

import type { Readable, Writable } from 'node:stream';
import { PRODUCT_NAME, PRODUCT_VERSION } from '@sentinel-forge/shared';
import {
  encodeMessage,
  ERROR_CODES,
  failure,
  LineBuffer,
  parseMessage,
  PROTOCOL_VERSION,
  success,
  SUPPORTED_PROTOCOL_VERSIONS,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type ToolResult,
} from './protocol.js';
import { findTool, redactResult, TOOLS, type ToolContext } from './tools.js';

/**
 * Sent to the client at initialization.
 *
 * It states the boundary in the place a client is most likely to read it, and
 * it states the product's central rule — that an absent value means "not
 * measured", not "nothing found" — because a model reading tool output without
 * that rule will draw the opposite conclusion.
 */
export const SERVER_INSTRUCTIONS = [
  `${PRODUCT_NAME} analyses FiveM servers and records what it finds locally. Every tool here is read-only:`,
  'nothing can modify the FiveM server, execute anything, change configuration, or reach the network.',
  '',
  'Three rules govern what these tools return:',
  '',
  '1. Findings are observations, not proofs. They indicate what was seen in code and in recorded evidence.',
  '   Security findings in particular are indicators requiring human verification, and the absence of a finding',
  '   is never evidence that a server is safe.',
  '2. An absent value means it was not collected, not that nothing was found. Where a tool returns null or says',
  '   a thing was not measured, report that — do not present it as a clean result.',
  '3. Correlation is not causation. Incidents group observations that occurred in the same window and their',
  '   confidence is capped at 0.85 for exactly that reason. Do not describe one observation as having caused another.',
  '',
  'Every tool result carries a `limitations` array. Carry it into any explanation you give of that result.',
].join('\n');

export interface McpServerOptions {
  readonly context: ToolContext;
  readonly stdin: Readable;
  readonly stdout: Writable;
}

export interface RunningMcpServer {
  /** Resolves when stdin closes, which is how a client shuts a stdio server down. */
  readonly done: Promise<void>;
  /** Stops reading and resolves `done`. */
  stop(): void;
}

/** Renders a tool's payload as the content block a client displays. */
export function toToolResult(data: Record<string, unknown>, failed: boolean): ToolResult {
  const redacted = redactResult(data);
  const text = JSON.stringify(redacted, null, 2);

  return {
    content: [{ type: 'text', text }],
    ...(failed ? { isError: true } : {}),
    structuredContent: redacted,
  };
}

/**
 * Answers one request.
 *
 * Returns `undefined` for a notification, which by JSON-RPC takes no response.
 */
export async function handleMessage(
  request: JsonRpcRequest,
  context: ToolContext,
): Promise<JsonRpcResponse | undefined> {
  const { id, method } = request;
  const isNotification = id === undefined;

  // A notification never gets a reply, whatever it says. `notifications/
  // initialized` is the one this server expects; the rest are acknowledged by
  // silence, which is what the protocol requires.
  if (isNotification) return undefined;

  switch (method) {
    case 'initialize': {
      const requested = request.params?.['protocolVersion'];
      // The specification: answer with the client's version when it is
      // supported, otherwise with the latest this server supports.
      const agreed =
        typeof requested === 'string' && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
          ? requested
          : PROTOCOL_VERSION;

      return success(id, {
        protocolVersion: agreed,
        capabilities: {
          // Tools only. This server offers no prompts, no resources, no
          // sampling and no logging channel: each would be another surface,
          // and none of them is needed to read a diagnosis.
          tools: { listChanged: false },
        },
        serverInfo: {
          name: 'sentinel-forge',
          title: `${PRODUCT_NAME} (read-only)`,
          version: PRODUCT_VERSION,
        },
        instructions: SERVER_INSTRUCTIONS,
      });
    }

    case 'ping':
      return success(id, {});

    case 'tools/list':
      return success(id, { tools: TOOLS.map((tool) => tool.definition) });

    case 'tools/call': {
      const name = request.params?.['name'];
      if (typeof name !== 'string') {
        return failure(id, ERROR_CODES.INVALID_PARAMS, 'tools/call requires a tool name.');
      }

      const tool = findTool(name);
      if (tool === undefined) {
        return failure(id, ERROR_CODES.INVALID_PARAMS, `Unknown tool: ${name}`, {
          available: TOOLS.map((candidate) => candidate.definition.name),
        });
      }

      const rawArguments = request.params?.['arguments'];
      const args =
        typeof rawArguments === 'object' && rawArguments !== null && !Array.isArray(rawArguments)
          ? (rawArguments as Record<string, unknown>)
          : {};

      try {
        const outcome = await tool.run(args, context);
        return success(id, toToolResult(outcome.data, outcome.failed === true));
      } catch (error) {
        // A tool that fails is a tool error, not a protocol error: the session
        // stays usable and the client can show the caller what went wrong.
        const message = error instanceof Error ? error.message : 'unknown error';
        context.logger.warn('An MCP tool failed.', { tool: name, error: message });
        return success(
          id,
          toToolResult({ error: `${name} could not complete: ${message}`, limitations: [] }, true),
        );
      }
    }

    default:
      return failure(id, ERROR_CODES.METHOD_NOT_FOUND, `Method not found: ${method}`);
  }
}

/**
 * Serves MCP over stdio until stdin closes.
 *
 * Messages are processed strictly in order. A tool call runs a scan, and two
 * calls arriving together must not start two scans of the same server or
 * interleave their replies on one pipe.
 */
export function serveStdio(options: McpServerOptions): RunningMcpServer {
  const buffer = new LineBuffer();
  let queue: Promise<void> = Promise.resolve();
  let stopped = false;

  const write = (message: JsonRpcResponse): void => {
    if (stopped) return;
    // stdout carries MCP messages and nothing else. Everything else the server
    // has to say goes to stderr, which the transport explicitly permits.
    options.stdout.write(encodeMessage(message));
  };

  let resolveDone: () => void = () => undefined;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  const onData = (chunk: Buffer | string): void => {
    for (const line of buffer.push(chunk.toString())) {
      const parsed = parseMessage(line);

      if (parsed.error !== undefined) {
        const { code, message, id } = parsed.error;
        options.context.logger.warn('An MCP message could not be read.', { message });
        // Queued rather than written immediately, so replies leave in the order
        // the messages arrived. A client correlates by id and would cope either
        // way, but a transcript that reorders itself is harder to debug.
        queue = queue.then(() => {
          write(failure(id, code, message));
        });
        continue;
      }

      const request = parsed.request;
      if (request === undefined) continue;

      queue = queue.then(async () => {
        const response = await handleMessage(request, options.context);
        if (response !== undefined) write(response);
      });
    }
  };

  const finish = (): void => {
    if (stopped) return;
    stopped = true;
    options.stdin.off('data', onData);
    // Anything already queued still completes; the writes are dropped once
    // stopped, which is correct when the pipe is gone.
    void queue.finally(resolveDone);
  };

  options.stdin.on('data', onData);
  options.stdin.once('end', finish);
  options.stdin.once('close', finish);

  return { done, stop: finish };
}
