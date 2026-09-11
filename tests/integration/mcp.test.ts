/**
 * Integration: the MCP server, spoken to as a client speaks to it.
 *
 * The transport is the part most likely to be wrong in a hand-written protocol
 * implementation, and it cannot be tested by calling functions: a client
 * launches a subprocess, writes newline-delimited JSON to its stdin, and reads
 * newline-delimited JSON from its stdout. So that is what this does.
 *
 * Two properties get particular attention, because both are normative and both
 * fail silently:
 *
 *   - stdout carries MCP messages and nothing else. One stray log line there
 *     breaks every client.
 *   - A message is one line. A finding's excerpt is multi-line Lua, so this is
 *     the ordinary case, not an edge case.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { cp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorkspace, fixturePath, removeWorkspace, repositoryRoot, runCli } from '../helpers/workspace.js';

interface RpcResponse {
  readonly jsonrpc: string;
  readonly id?: string | number | null;
  readonly result?: Record<string, unknown>;
  readonly error?: { code: number; message: string; data?: unknown };
}

interface ToolCallResult {
  readonly content: { type: string; text: string }[];
  readonly isError?: boolean;
  readonly structuredContent?: Record<string, unknown>;
}

/** A client that speaks to the server the way an MCP client does. */
class McpProbe {
  private readonly child: ChildProcessWithoutNullStreams;
  private buffer = '';
  private readonly pending = new Map<number, (response: RpcResponse) => void>();
  private nextId = 1;
  stderr = '';
  /** Every line stdout produced, so a stray non-message line is visible. */
  readonly stdoutLines: string[] = [];

  constructor(cwd: string) {
    this.child = spawn('node', [path.join(repositoryRoot, 'apps/cli/dist/bin/sentinel.js'), 'mcp'], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => {
      this.buffer += chunk;
      const lines = this.buffer.split('\n');
      this.buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim().length === 0) continue;
        this.stdoutLines.push(line);
        const message = JSON.parse(line) as RpcResponse;
        if (typeof message.id === 'number') this.pending.get(message.id)?.(message);
      }
    });

    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (chunk: string) => {
      this.stderr += chunk;
    });
  }

  send(method: string, params?: Record<string, unknown>): Promise<RpcResponse> {
    const id = this.nextId++;
    const message = JSON.stringify({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });

    return new Promise<RpcResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`No response to ${method} within 60s. stderr: ${this.stderr}`));
      }, 60_000);

      this.pending.set(id, (response) => {
        clearTimeout(timer);
        this.pending.delete(id);
        resolve(response);
      });

      this.child.stdin.write(`${message}\n`);
    });
  }

  /** Sends a raw line, for the cases a well-behaved client would never produce. */
  sendRaw(line: string): void {
    this.child.stdin.write(`${line}\n`);
  }

  notify(method: string): void {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`);
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<ToolCallResult> {
    const response = await this.send('tools/call', { name, arguments: args });
    if (response.error !== undefined) {
      throw new Error(`tools/call ${name} returned a protocol error: ${response.error.message}`);
    }
    return response.result as unknown as ToolCallResult;
  }

  close(): Promise<number | null> {
    return new Promise((resolve) => {
      this.child.once('exit', (code) => {
        resolve(code);
      });
      this.child.stdin.end();
    });
  }
}

describe('mcp server', () => {
  let workspace: string;
  let server: string;
  let probe: McpProbe;

  beforeAll(async () => {
    workspace = await createWorkspace('sentinel-mcp-');
    server = path.join(workspace, 'server');
    await cp(fixturePath('healthy-server'), server, { recursive: true });

    // Telemetry, so the performance tool reports measured data rather than only
    // its "no collector" branch.
    const telemetry = path.join(server, 'resources', 'sentinel_doctor', 'telemetry');
    await mkdir(telemetry, { recursive: true });
    await writeFile(
      path.join(telemetry, 'sentinel-telemetry-01.json'),
      JSON.stringify({
        schemaVersion: '1.0',
        collector: 'sentinel_doctor',
        collectorVersion: '0.7.0',
        writtenAt: 1_772_366_400,
        serverUptimeMs: 3_600_000,
        samples: [{ metric: 'scheduler_latency_ms', value: 3, unit: 'ms', playerCount: 12, at: 1_772_366_390 }],
        events: [{ kind: 'resource_started', resource: 'sf_core', detail: 'started', at: 1_772_366_395 }],
        dropped: { samples: 0, events: 0 },
      }),
      'utf8',
    );

    await runCli(['init', '--server', server], workspace);
    await runCli(['scan'], workspace);
    await runCli(['runtime', 'import'], workspace);
    await runCli(['baseline', 'create', 'before'], workspace);
    await runCli(['baseline', 'create', 'after'], workspace);
    await runCli(['integrity', 'snapshot', 'one'], workspace);
    await runCli(['integrity', 'snapshot', 'two'], workspace);

    probe = new McpProbe(workspace);
  }, 180_000);

  afterAll(async () => {
    await probe.close();
    await removeWorkspace(workspace);
  });

  it('completes the initialization handshake', async () => {
    const response = await probe.send('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'sentinel-forge-tests', version: '1.0.0' },
    });

    expect(response.error).toBeUndefined();
    expect(response.result).toMatchObject({
      protocolVersion: '2025-06-18',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'sentinel-forge' },
    });
    expect(response.result?.['instructions']).toContain('read-only');

    probe.notify('notifications/initialized');
  });

  it('answers a ping', async () => {
    const response = await probe.send('ping');
    expect(response.result).toEqual({});
  });

  it('lists ten read-only tools', async () => {
    const response = await probe.send('tools/list');
    const tools = (response.result as { tools: { name: string; annotations: { readOnlyHint: boolean } }[] }).tools;

    expect(tools).toHaveLength(10);
    for (const tool of tools) {
      expect(tool.annotations.readOnlyHint, tool.name).toBe(true);
    }
  });

  it('runs every tool and returns a payload carrying its limitations', async () => {
    const calls: [string, Record<string, unknown>][] = [
      ['sentinel_scan', {}],
      ['sentinel_health', {}],
      ['sentinel_resource', { name: 'sf_core' }],
      ['sentinel_dependencies', {}],
      ['sentinel_performance', {}],
      ['sentinel_compare', { before: 'before', after: 'after' }],
      ['sentinel_security', {}],
      ['sentinel_integrity', { before: 'one', after: 'two' }],
      ['sentinel_incidents', {}],
      ['sentinel_report', {}],
    ];

    for (const [name, args] of calls) {
      const result = await probe.callTool(name, args);

      expect(result.isError, name).toBeUndefined();
      expect(result.content[0]?.type, name).toBe('text');

      const payload = JSON.parse(result.content[0]?.text ?? '{}') as { limitations?: unknown };
      // The rule this whole surface turns on: a model receiving a finding
      // without the sentence saying what it does not establish will present it
      // as proven.
      expect(Array.isArray(payload.limitations), `${name} must carry limitations`).toBe(true);
      expect((payload.limitations as unknown[]).length, `${name} limitations must not be empty`).toBeGreaterThan(0);
      expect(result.structuredContent, name).toEqual(payload);
    }
  }, 120_000);

  it('says a thing was not measured rather than returning an empty result', async () => {
    const result = await probe.callTool('sentinel_performance');
    const payload = JSON.parse(result.content[0]?.text ?? '{}') as {
      collectorInstalled: boolean;
      measured: { metrics: string[] } | null;
      notMeasuredReason: string | null;
    };

    expect(payload.collectorInstalled).toBe(true);
    expect(payload.measured?.metrics).toContain('scheduler_latency_ms');
    expect(payload.notMeasuredReason).toBeNull();
  });

  it('reports a missing resource as a tool error, and names the ones that exist', async () => {
    const result = await probe.callTool('sentinel_resource', { name: 'sf_not_here' });

    expect(result.isError).toBe(true);
    const payload = JSON.parse(result.content[0]?.text ?? '{}') as {
      error: string;
      discoveredResources: string[];
    };
    expect(payload.error).toContain('sf_not_here');
    expect(payload.discoveredResources).toContain('sf_core');
  });

  it('reports a missing baseline as a tool error, not a protocol error', async () => {
    const result = await probe.callTool('sentinel_compare', { before: 'before', after: 'nope' });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('nope');
  });

  it('never claims causation in a comparison', async () => {
    const result = await probe.callTool('sentinel_compare', { before: 'before', after: 'after' });
    const text = result.content[0]?.text ?? '';

    expect(text).toContain('never establishes that one caused the other');
    expect(text).not.toMatch(/\bcaused by\b/i);
    expect(text).not.toMatch(/\bbecause of\b/i);
  });

  it('reports an unknown tool and an unknown method as protocol errors', async () => {
    const unknownTool = await probe.send('tools/call', { name: 'sentinel_fix', arguments: {} });
    expect(unknownTool.error?.code).toBe(-32602);

    const unknownMethod = await probe.send('resources/list');
    expect(unknownMethod.error?.code).toBe(-32601);
  });

  it('survives a malformed message and keeps serving', async () => {
    probe.sendRaw('{ this is not json');
    probe.sendRaw('"not an object"');

    // The session must still work afterwards: a server that dies on one bad
    // message takes the assistant's whole session with it.
    const response = await probe.send('ping');
    expect(response.result).toEqual({});
  });

  it('writes only protocol messages to stdout', async () => {
    // Normative: the server MUST NOT write anything to stdout that is not a
    // valid MCP message. One stray log line breaks every client.
    await probe.callTool('sentinel_scan');

    expect(probe.stdoutLines.length).toBeGreaterThan(5);
    for (const line of probe.stdoutLines) {
      const parsed = JSON.parse(line) as RpcResponse;
      expect(parsed.jsonrpc, line.slice(0, 60)).toBe('2.0');
    }
  });

  it('writes its logs to stderr', () => {
    expect(probe.stderr).toContain('Serving the read-only MCP interface');
  });

  it('puts each message on exactly one line, however multi-line its content', async () => {
    // A finding's evidence excerpt is multi-line Lua. If an excerpt reached the
    // wire unescaped it would split one message into several and desynchronise
    // the session.
    const result = await probe.callTool('sentinel_report');
    expect(result.content[0]?.text).toContain('\n');

    for (const line of probe.stdoutLines) {
      expect(line).not.toContain('\n');
    }
  });

  it('refuses --json, because stdout is reserved for the protocol', async () => {
    const attempt = await runCli(['mcp', '--json'], workspace);
    expect(attempt.exitCode).toBe(2);
    expect(attempt.stdout).toContain('reserves stdout');
  });

  it('exits cleanly when the client closes its input', async () => {
    const closing = new McpProbe(workspace);
    await closing.send('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
    expect(await closing.close()).toBe(0);
  }, 60_000);
});
