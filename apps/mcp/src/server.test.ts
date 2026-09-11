import { describe, expect, it } from 'vitest';
import { createSilentLogger } from '@sentinel-forge/core';
import { PRODUCT_VERSION } from '@sentinel-forge/shared';
import { handleMessage, SERVER_INSTRUCTIONS, toToolResult } from './server.js';
import { ERROR_CODES, PROTOCOL_VERSION } from './protocol.js';
import { TOOLS, type ToolContext } from './tools.js';

/**
 * A context whose analysis would throw if touched.
 *
 * Every test here covers dispatch, not tool execution: if one of them reaches
 * the analysis it is testing something other than what it claims to.
 */
const context = {
  analysis: new Proxy({} as never, {
    get() {
      throw new Error('dispatch must not touch the analysis context');
    },
  }),
  logger: createSilentLogger(),
} as unknown as ToolContext;

function request(method: string, params?: Record<string, unknown>, id: number | string = 1) {
  return { jsonrpc: '2.0' as const, id, method, ...(params === undefined ? {} : { params }) };
}

describe('initialize', () => {
  it('answers with the client\'s protocol version when it supports it', async () => {
    for (const version of ['2025-06-18', '2025-03-26', '2024-11-05']) {
      const response = await handleMessage(request('initialize', { protocolVersion: version }), context);
      expect(response, version).toMatchObject({ result: { protocolVersion: version } });
    }
  });

  it('answers with its own latest version when the client asks for something else', async () => {
    // What the specification requires: respond with another version the server
    // supports, which SHOULD be the latest.
    for (const version of ['1.0.0', '2099-01-01', '']) {
      const response = await handleMessage(request('initialize', { protocolVersion: version }), context);
      expect(response, version).toMatchObject({ result: { protocolVersion: PROTOCOL_VERSION } });
    }
  });

  it('declares tools and nothing else', async () => {
    const response = await handleMessage(request('initialize', { protocolVersion: PROTOCOL_VERSION }), context);
    const result = (response as { result: { capabilities: Record<string, unknown> } }).result;

    expect(Object.keys(result.capabilities)).toEqual(['tools']);
    expect(result.capabilities['tools']).toEqual({ listChanged: false });
  });

  it('identifies itself with the product version', async () => {
    const response = await handleMessage(request('initialize'), context);
    expect(response).toMatchObject({
      result: { serverInfo: { name: 'sentinel-forge', version: PRODUCT_VERSION } },
    });
  });

  it('sends instructions that state the read-only boundary and the three rules', async () => {
    const response = await handleMessage(request('initialize'), context);
    const instructions = (response as { result: { instructions: string } }).result.instructions;

    expect(instructions).toBe(SERVER_INSTRUCTIONS);
    expect(instructions).toContain('read-only');
    expect(instructions).toContain('absence of a finding');
    expect(instructions).toContain('not collected');
    expect(instructions).toContain('Correlation is not causation');
    expect(instructions).toContain('limitations');
  });
});

describe('dispatch', () => {
  it('answers ping with an empty result', async () => {
    expect(await handleMessage(request('ping'), context)).toEqual({ jsonrpc: '2.0', id: 1, result: {} });
  });

  it('never answers a notification', async () => {
    for (const method of ['notifications/initialized', 'notifications/cancelled', 'anything']) {
      const notification = { jsonrpc: '2.0' as const, method };
      expect(await handleMessage(notification, context), method).toBeUndefined();
    }
  });

  it('reports an unknown method as method-not-found', async () => {
    const response = await handleMessage(request('resources/list'), context);
    expect(response).toMatchObject({ error: { code: ERROR_CODES.METHOD_NOT_FOUND } });
  });

  it('reports an unknown tool as a protocol error, and names the real ones', async () => {
    const response = await handleMessage(request('tools/call', { name: 'sentinel_fix' }), context);
    expect(response).toMatchObject({ error: { code: ERROR_CODES.INVALID_PARAMS } });

    const available = (response as { error: { data: { available: string[] } } }).error.data.available;
    expect(available).toHaveLength(10);
    expect(available).toContain('sentinel_scan');
  });

  it('refuses a tools/call with no tool name', async () => {
    const response = await handleMessage(request('tools/call', {}), context);
    expect(response).toMatchObject({ error: { code: ERROR_CODES.INVALID_PARAMS } });
  });

  it('preserves the request id, whatever its type', async () => {
    expect(await handleMessage(request('ping', undefined, 'abc'), context)).toMatchObject({ id: 'abc' });
    expect(await handleMessage(request('ping', undefined, 0), context)).toMatchObject({ id: 0 });
  });
});

describe('tools/list', () => {
  it('lists the ten tools the specification names', async () => {
    const response = await handleMessage(request('tools/list'), context);
    const tools = (response as { result: { tools: { name: string }[] } }).result.tools;

    expect(tools.map((tool) => tool.name)).toEqual([
      'sentinel_scan',
      'sentinel_health',
      'sentinel_resource',
      'sentinel_dependencies',
      'sentinel_performance',
      'sentinel_compare',
      'sentinel_security',
      'sentinel_integrity',
      'sentinel_incidents',
      'sentinel_report',
    ]);
  });

  it('declares every tool read-only, non-destructive and closed-world', async () => {
    // The specification's defaults are the opposite: destructiveHint defaults
    // to true and openWorldHint defaults to true. A read-only server that lets
    // those stand is describing itself as a destructive one.
    const response = await handleMessage(request('tools/list'), context);
    const tools = (response as { result: { tools: { name: string; annotations?: Record<string, unknown> }[] } })
      .result.tools;

    for (const tool of tools) {
      expect(tool.annotations, tool.name).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
    }
  });

  it('gives every tool a description that states what it does not establish', async () => {
    const response = await handleMessage(request('tools/list'), context);
    const tools = (response as { result: { tools: { name: string; description: string }[] } }).result.tools;

    for (const tool of tools) {
      expect(tool.description.length, tool.name).toBeGreaterThan(80);
    }

    const byName = new Map(tools.map((tool) => [tool.name, tool.description]));
    expect(byName.get('sentinel_scan')).toContain('not evidence that a server is safe');
    expect(byName.get('sentinel_security')).toContain('requiring human verification');
    expect(byName.get('sentinel_compare')).toContain('never states that one caused the other');
    expect(byName.get('sentinel_performance')).toContain('no scripting API for per-resource CPU');
  });

  it('gives every tool a valid JSON Schema object for its input', async () => {
    const response = await handleMessage(request('tools/list'), context);
    const tools = (response as { result: { tools: { name: string; inputSchema: Record<string, unknown> }[] } })
      .result.tools;

    for (const tool of tools) {
      expect(tool.inputSchema['type'], tool.name).toBe('object');
      expect(tool.inputSchema['properties'], tool.name).toBeTypeOf('object');
      // A tool that accepted unknown arguments would silently ignore a caller's
      // mistake, and a model's mistaken argument would look like a working call.
      expect(tool.inputSchema['additionalProperties'], tool.name).toBe(false);
    }
  });

  it('registers no tool whose name suggests it changes anything', () => {
    const forbidden = /fix|write|delete|remove|install|restart|stop|start|execute|run|patch|update|set/i;
    for (const tool of TOOLS) {
      expect(forbidden.test(tool.definition.name), tool.definition.name).toBe(false);
    }
  });
});

describe('toToolResult', () => {
  it('returns the payload as both text and structured content', () => {
    const result = toToolResult({ findings: [], limitations: ['A limitation.'] }, false);

    expect(result.content).toHaveLength(1);
    expect(result.content[0]?.type).toBe('text');
    expect(JSON.parse(result.content[0]?.text ?? '{}')).toEqual(result.structuredContent);
    expect(result.isError).toBeUndefined();
  });

  it('marks a failure as a tool error rather than a protocol error', () => {
    expect(toToolResult({ error: 'No such resource.' }, true).isError).toBe(true);
  });

  it('redacts on the way out', () => {
    // Belt and braces: nothing should reach here unredacted, and this is the
    // surface where a leak would be copied into a model's context.
    //
    // The value is assembled at runtime rather than written as a literal, so
    // nothing in the repository reads as a credential — the rule the hygiene
    // suite enforces over the whole source tree.
    const fabricated = ['abcdef01', '23456789'].join('');
    const result = toToolResult({ config: { sv_licenseKey: fabricated } }, false);
    expect(result.content[0]?.text).not.toContain(fabricated);
  });
});
