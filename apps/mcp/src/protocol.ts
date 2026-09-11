/**
 * JSON-RPC 2.0 and the MCP message shapes, implemented directly.
 *
 * Sentinel Forge takes no third-party runtime dependency, and that applies here
 * too: the protocol is a documented wire format, and implementing the small
 * part of it this server needs is cheaper than adding an SDK — and its supply
 * chain — to a product whose entire pitch is that it does not run other
 * people's code.
 *
 * Every shape below was checked against the official specification and the
 * published schema for protocol version 2025-06-18:
 *
 *   - https://modelcontextprotocol.io/specification/2025-06-18/basic/transports
 *   - https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle
 *   - https://modelcontextprotocol.io/specification/2025-06-18/server/tools
 *   - modelcontextprotocol/modelcontextprotocol → schema/2025-06-18/schema.ts
 *
 * Two normative requirements of the stdio transport shape this file:
 *
 *   1. **Messages are newline-delimited and MUST NOT contain an embedded
 *      newline.** `JSON.stringify` never emits a raw newline inside a string —
 *      it escapes them — so one `JSON.stringify` per line satisfies this, and
 *      {@link encodeMessage} asserts it rather than assuming it.
 *   2. **The server MUST NOT write anything to stdout that is not a valid MCP
 *      message.** Logging therefore goes to stderr, which the specification
 *      explicitly permits.
 *
 * © 2026 Talal Al Ghafri. All Rights Reserved.
 */

import { SentinelInternalError } from '@sentinel-forge/core';

/** The protocol version this server implements. */
export const PROTOCOL_VERSION = '2025-06-18';

/**
 * Versions this server will accept if a client asks for one of them.
 *
 * A client asking for something else is answered with `PROTOCOL_VERSION`, which
 * is what the specification requires: respond with the same version when it is
 * supported, otherwise with the latest version the server supports.
 */
export const SUPPORTED_PROTOCOL_VERSIONS: readonly string[] = Object.freeze([
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
]);

/** JSON-RPC error codes, as defined by JSON-RPC 2.0 and carried by MCP. */
export const ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

export type RequestId = string | number;

export interface JsonRpcRequest {
  readonly jsonrpc: '2.0';
  readonly id?: RequestId;
  readonly method: string;
  readonly params?: Record<string, unknown>;
}

export interface JsonRpcSuccess {
  readonly jsonrpc: '2.0';
  readonly id: RequestId;
  readonly result: unknown;
}

export interface JsonRpcFailure {
  readonly jsonrpc: '2.0';
  readonly id: RequestId | null;
  readonly error: { readonly code: number; readonly message: string; readonly data?: unknown };
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure;

/** Text content, the only content type this server produces. */
export interface TextContent {
  readonly type: 'text';
  readonly text: string;
}

export interface ToolResult {
  readonly content: readonly TextContent[];
  /** True when the tool ran and failed. A protocol error is a different thing. */
  readonly isError?: boolean;
  /** The same data as the text block, as an object. */
  readonly structuredContent?: Record<string, unknown>;
}

/**
 * Behavioural hints published with every tool.
 *
 * All four are stated explicitly rather than left to default, because the
 * defaults are the opposite of what is true here: `destructiveHint` defaults to
 * `true` and `openWorldHint` defaults to `true`. A read-only server that lets
 * those defaults stand is describing itself as a destructive one.
 */
export interface ToolAnnotations {
  readonly title?: string;
  readonly readOnlyHint?: boolean;
  readonly destructiveHint?: boolean;
  readonly idempotentHint?: boolean;
  readonly openWorldHint?: boolean;
}

export interface ToolDefinition {
  readonly name: string;
  readonly title?: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly annotations?: ToolAnnotations;
}

export function success(id: RequestId, result: unknown): JsonRpcSuccess {
  return { jsonrpc: '2.0', id, result };
}

export function failure(
  id: RequestId | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcFailure {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export interface ParsedMessage {
  readonly request?: JsonRpcRequest;
  /** Set when the line could not be read as a request, with the code to answer. */
  readonly error?: { readonly code: number; readonly message: string; readonly id: RequestId | null };
}

/**
 * Reads one line as a JSON-RPC request.
 *
 * Never throws. A malformed line is answered with a protocol error rather than
 * killing the server: an MCP server that exits on one bad message takes the
 * assistant's whole session with it.
 */
export function parseMessage(line: string): ParsedMessage {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return { error: { code: ERROR_CODES.PARSE_ERROR, message: 'Message was not valid JSON.', id: null } };
  }

  if (!isRecord(value)) {
    return { error: { code: ERROR_CODES.INVALID_REQUEST, message: 'Message was not a JSON object.', id: null } };
  }

  const id = value['id'];
  const responseId = typeof id === 'string' || typeof id === 'number' ? id : null;

  if (value['jsonrpc'] !== '2.0') {
    return {
      error: { code: ERROR_CODES.INVALID_REQUEST, message: 'Message did not declare jsonrpc "2.0".', id: responseId },
    };
  }

  const method = value['method'];
  if (typeof method !== 'string') {
    // A response to a request this server never sent: it sends none, so this is
    // either a client defect or a stray message. Neither is fatal.
    return {
      error: { code: ERROR_CODES.INVALID_REQUEST, message: 'Message declared no method.', id: responseId },
    };
  }

  const params = value['params'];

  return {
    request: {
      jsonrpc: '2.0',
      ...(responseId === null ? {} : { id: responseId }),
      method,
      ...(isRecord(params) ? { params } : {}),
    },
  };
}

/**
 * Serialises one message for the stdio transport.
 *
 * @throws {SentinelInternalError} if the encoded message contains a newline,
 *   which would split one message into two on the wire and desynchronise the
 *   session. `JSON.stringify` escapes newlines inside strings, so this cannot
 *   happen — which is exactly why it is worth asserting: a future change that
 *   made it possible would otherwise fail somewhere far from its cause.
 */
export function encodeMessage(message: JsonRpcResponse | JsonRpcRequest): string {
  const encoded = JSON.stringify(message);

  if (encoded.includes('\n') || encoded.includes('\r')) {
    throw new SentinelInternalError('An MCP message contained an embedded newline and was not sent.');
  }

  return `${encoded}\n`;
}

/**
 * Splits a stream of bytes into complete lines.
 *
 * stdin arrives in arbitrary chunks: one read can hold half a message, or three
 * messages and a fragment. Anything after the final newline is held until the
 * rest of it arrives.
 */
export class LineBuffer {
  private pending = '';

  /** Adds a chunk and returns every complete line it completed. */
  push(chunk: string): string[] {
    this.pending += chunk;
    const lines = this.pending.split('\n');
    // The last element is whatever followed the final newline — possibly empty,
    // possibly a partial message. It stays buffered.
    this.pending = lines.pop() ?? '';
    return lines.map((line) => line.replace(/\r$/, '')).filter((line) => line.trim().length > 0);
  }

  /** Bytes held back awaiting the rest of a message. */
  get buffered(): string {
    return this.pending;
  }
}
