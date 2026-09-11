import { describe, expect, it } from 'vitest';
import { SentinelInternalError } from '@sentinel-forge/core';
import {
  encodeMessage,
  ERROR_CODES,
  LineBuffer,
  parseMessage,
  PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
} from './protocol.js';

describe('protocol constants', () => {
  it('implements a protocol version it also declares support for', () => {
    expect(SUPPORTED_PROTOCOL_VERSIONS).toContain(PROTOCOL_VERSION);
    expect(PROTOCOL_VERSION).toBe('2025-06-18');
  });

  it('uses the JSON-RPC 2.0 error codes', () => {
    expect(ERROR_CODES).toEqual({
      PARSE_ERROR: -32700,
      INVALID_REQUEST: -32600,
      METHOD_NOT_FOUND: -32601,
      INVALID_PARAMS: -32602,
      INTERNAL_ERROR: -32603,
    });
  });
});

describe('parseMessage', () => {
  it('reads a request', () => {
    const parsed = parseMessage('{"jsonrpc":"2.0","id":1,"method":"ping"}');
    expect(parsed.request).toEqual({ jsonrpc: '2.0', id: 1, method: 'ping' });
  });

  it('reads a notification, which carries no id', () => {
    const parsed = parseMessage('{"jsonrpc":"2.0","method":"notifications/initialized"}');
    expect(parsed.request).toEqual({ jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(parsed.request).not.toHaveProperty('id');
  });

  it('reports malformed JSON as a parse error rather than throwing', () => {
    // An MCP server that dies on one bad message takes the assistant's whole
    // session with it.
    const parsed = parseMessage('{ not json');
    expect(parsed.request).toBeUndefined();
    expect(parsed.error).toMatchObject({ code: ERROR_CODES.PARSE_ERROR, id: null });
  });

  it('refuses a message that is not a JSON object', () => {
    for (const line of ['"a string"', '[1,2,3]', '42', 'null']) {
      expect(parseMessage(line).error?.code, line).toBe(ERROR_CODES.INVALID_REQUEST);
    }
  });

  it('refuses a message that does not declare jsonrpc 2.0', () => {
    const parsed = parseMessage('{"id":1,"method":"ping"}');
    expect(parsed.error).toMatchObject({ code: ERROR_CODES.INVALID_REQUEST, id: 1 });
  });

  it('refuses a message with no method, and answers to its id when it has one', () => {
    expect(parseMessage('{"jsonrpc":"2.0","id":7,"result":{}}').error).toMatchObject({
      code: ERROR_CODES.INVALID_REQUEST,
      id: 7,
    });
  });

  it('keeps a string id as a string and a number id as a number', () => {
    expect(parseMessage('{"jsonrpc":"2.0","id":"abc","method":"ping"}').request?.id).toBe('abc');
    expect(parseMessage('{"jsonrpc":"2.0","id":9,"method":"ping"}').request?.id).toBe(9);
  });

  it('treats a non-object params as absent rather than trusting it', () => {
    const parsed = parseMessage('{"jsonrpc":"2.0","id":1,"method":"tools/call","params":"hostile"}');
    expect(parsed.request).not.toHaveProperty('params');
  });
});

describe('encodeMessage', () => {
  it('ends every message with exactly one newline', () => {
    const encoded = encodeMessage({ jsonrpc: '2.0', id: 1, result: { ok: true } });
    expect(encoded.endsWith('\n')).toBe(true);
    expect(encoded.slice(0, -1)).not.toContain('\n');
  });

  it('escapes a newline inside a value instead of emitting it', () => {
    // The transport requires that a message contain no embedded newline. A
    // finding's excerpt is multi-line Lua, so this is the ordinary case here,
    // not an edge case.
    const encoded = encodeMessage({
      jsonrpc: '2.0',
      id: 1,
      result: { text: 'while true do\n  work()\nend' },
    });
    expect(encoded.split('\n')).toHaveLength(2);
    expect(JSON.parse(encoded) as { result: { text: string } }).toMatchObject({
      result: { text: 'while true do\n  work()\nend' },
    });
  });

  it('refuses to send a message that would split in two', () => {
    // Unreachable through JSON.stringify, which is why it is asserted: a future
    // change that made it reachable would otherwise desynchronise a session
    // somewhere far from its cause.
    const message = { jsonrpc: '2.0', id: 1, result: {} } as const;
    const original = JSON.stringify;
    try {
      (JSON as { stringify: unknown }).stringify = () => '{"jsonrpc":"2.0",\n"id":1}';
      expect(() => encodeMessage(message)).toThrow(SentinelInternalError);
    } finally {
      (JSON as { stringify: unknown }).stringify = original;
    }
  });
});

describe('LineBuffer', () => {
  it('returns complete lines and holds a partial one', () => {
    const buffer = new LineBuffer();
    expect(buffer.push('{"a":1}\n{"b":2}\n{"c"')).toEqual(['{"a":1}', '{"b":2}']);
    expect(buffer.buffered).toBe('{"c"');
    expect(buffer.push(':3}\n')).toEqual(['{"c":3}']);
    expect(buffer.buffered).toBe('');
  });

  it('reassembles a message split across several chunks', () => {
    // stdin arrives in arbitrary chunks; a large tool result travelling the
    // other way proves the same property in reverse.
    const buffer = new LineBuffer();
    expect(buffer.push('{"jso')).toEqual([]);
    expect(buffer.push('nrpc":')).toEqual([]);
    expect(buffer.push('"2.0"}')).toEqual([]);
    expect(buffer.push('\n')).toEqual(['{"jsonrpc":"2.0"}']);
  });

  it('tolerates carriage returns and blank lines', () => {
    const buffer = new LineBuffer();
    expect(buffer.push('{"a":1}\r\n\n   \n{"b":2}\n')).toEqual(['{"a":1}', '{"b":2}']);
  });

  it('handles several messages arriving in one chunk', () => {
    const buffer = new LineBuffer();
    const lines = buffer.push('{"a":1}\n{"b":2}\n{"c":3}\n');
    expect(lines).toHaveLength(3);
  });
});
