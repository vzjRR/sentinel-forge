/**
 * Security: the MCP interface must not become a way around the boundaries.
 *
 * This surface is different from the others in one way that matters: its
 * consumer is a language model, and whatever it returns may be copied into a
 * conversation, a transcript, and a model provider's logs. Two failures would
 * be severe:
 *
 *   1. **Returning a credential.** A secret in a tool result does not stay in
 *      the tool result.
 *   2. **Offering a tool that changes something.** An assistant acting on a
 *      mistaken inference with a tool that can restart a resource or edit a
 *      file breaks a live server. The read-only boundary is the design, and it
 *      has to be a property of what is registered rather than of what each
 *      handler happens to do today.
 *
 * Both are asserted against the real server, spoken to over real pipes.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TOOLS } from '@sentinel-forge/mcp';
import { allFabricatedSecrets, fabricatedLeakyResource } from '../helpers/fabricated-credentials.js';
import { createWorkspace, fixturePath, removeWorkspace, repositoryRoot, runCli } from '../helpers/workspace.js';

interface RpcResponse {
  readonly id?: number | string | null;
  readonly result?: Record<string, unknown>;
  readonly error?: { code: number; message: string };
}

class Probe {
  private readonly child: ChildProcessWithoutNullStreams;
  private buffer = '';
  private readonly pending = new Map<number, (response: RpcResponse) => void>();
  private id = 1;

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
        const message = JSON.parse(line) as RpcResponse;
        if (typeof message.id === 'number') this.pending.get(message.id)?.(message);
      }
    });
    // Drained so the pipe cannot fill and stall the child.
    this.child.stderr.resume();
  }

  send(method: string, params?: Record<string, unknown>): Promise<RpcResponse> {
    const id = this.id++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`No response to ${method} within 60s.`));
      }, 60_000);
      this.pending.set(id, (response) => {
        clearTimeout(timer);
        resolve(response);
      });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params })})}\n`);
    });
  }

  async text(name: string, args: Record<string, unknown> = {}): Promise<string> {
    const response = await this.send('tools/call', { name, arguments: args });
    if (response.error !== undefined) return JSON.stringify(response.error);
    const result = response.result as unknown as { content: { text: string }[] };
    return result.content.map((entry) => entry.text).join('\n');
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      this.child.once('exit', () => {
        resolve();
      });
      this.child.stdin.end();
    });
  }
}

describe('mcp exposure', () => {
  let workspace: string;
  let server: string;
  let probe: Probe;
  let secrets: string[];

  beforeAll(async () => {
    workspace = await createWorkspace('sentinel-mcp-security-');
    server = path.join(workspace, 'server');
    await cp(fixturePath('security-indicators'), server, { recursive: true });

    const leaky = path.join(server, 'resources', 'sf_leaky');
    await mkdir(leaky, { recursive: true });
    for (const [name, content] of Object.entries(fabricatedLeakyResource())) {
      await writeFile(path.join(leaky, name), content, 'utf8');
    }

    const licenseKey = ['cfx', 'k1', '7Kd93MzQpXvR2NwL5tYbHcJ8rT4mQ9vLp2WxZbN6'].join('_');
    const databasePassword = '8Jd2kQpV9mXr';
    await writeFile(
      path.join(server, 'server.cfg'),
      [
        'ensure sf_leaky',
        `set sv_licenseKey "${licenseKey}"`,
        `set mysql_connection_string "mysql://sf:${databasePassword}@db.invalid:3306/sf"`,
      ].join('\n'),
      'utf8',
    );

    secrets = [...allFabricatedSecrets(), licenseKey, databasePassword].filter((value) => value.length >= 8);

    await runCli(['init', '--server', server], workspace);
    await runCli(['scan'], workspace);
    await runCli(['baseline', 'create', 'before'], workspace);
    await runCli(['baseline', 'create', 'after'], workspace);
    await runCli(['integrity', 'snapshot', 'one'], workspace);
    await runCli(['integrity', 'snapshot', 'two'], workspace);

    probe = new Probe(workspace);
  }, 180_000);

  afterAll(async () => {
    await probe.close();
    await removeWorkspace(workspace);
  });

  it('plants credentials the detector actually finds', async () => {
    expect(secrets.length).toBeGreaterThanOrEqual(4);
    expect(await probe.text('sentinel_security')).toContain('SEC-SECRET-001');
  });

  it('returns no credential from any tool', async () => {
    const calls: [string, Record<string, unknown>][] = [
      ['sentinel_scan', { limit: 500 }],
      ['sentinel_health', {}],
      ['sentinel_resource', { name: 'sf_leaky' }],
      ['sentinel_dependencies', {}],
      ['sentinel_performance', {}],
      ['sentinel_compare', { before: 'before', after: 'after' }],
      ['sentinel_security', { limit: 500 }],
      ['sentinel_integrity', { before: 'one', after: 'two' }],
      ['sentinel_incidents', {}],
      ['sentinel_report', {}],
    ];

    for (const [name, args] of calls) {
      const text = await probe.text(name, args);
      for (const secret of secrets) {
        expect(text, `${name} returned ${secret.slice(0, 6)}…`).not.toContain(secret);
      }
    }
  }, 120_000);

  it('returns credential findings by location, with the value masked', async () => {
    const text = await probe.text('sentinel_security', { limit: 500 });

    // The finding is useful — it names a file and a line — and still carries no
    // value. Both halves matter: a detector that reported nothing would pass a
    // leak test vacuously.
    expect(text).toMatch(/resources\/sf_leaky\/\w+\.lua/);
    expect(text).toContain('"line"');
    expect(text).toContain('*');
  });

  it('registers no tool that can change anything', () => {
    // Asserted against the registry rather than against behaviour: the boundary
    // has to hold for a tool added next year by someone who has not read this.
    for (const tool of TOOLS) {
      expect(tool.definition.annotations?.readOnlyHint, tool.definition.name).toBe(true);
      expect(tool.definition.annotations?.destructiveHint, tool.definition.name).toBe(false);
      expect(tool.definition.annotations?.openWorldHint, tool.definition.name).toBe(false);
    }
  });

  it('exposes exactly the ten tools the specification names, and no eleventh', () => {
    expect(TOOLS.map((tool) => tool.definition.name).sort()).toEqual(
      [
        'sentinel_compare',
        'sentinel_dependencies',
        'sentinel_health',
        'sentinel_incidents',
        'sentinel_integrity',
        'sentinel_performance',
        'sentinel_report',
        'sentinel_resource',
        'sentinel_scan',
        'sentinel_security',
      ].sort(),
    );
  });

  it('has no tool source that writes, executes or reaches the network', async () => {
    const source = await readFile(path.join(repositoryRoot, 'apps/mcp/src/tools.ts'), 'utf8');

    for (const pattern of [
      /\bwriteFile\b/,
      /\bmkdir\b/,
      /\brm\b\(/,
      /\bunlink\b/,
      /\bfetch\s*\(/,
      /child_process/,
      /\bpersistScan\b/,
      /\bpersistIncidents\b/,
      /\bcreateSnapshot\b/,
      /\bcaptureBaseline\b/,
      /\brecordSamples\b/,
      /\bingestTelemetry\b/,
      /\bpurge\b/,
      /\bDELETE\b/,
      /\bINSERT\b/,
      /\bUPDATE\b/,
    ]) {
      expect(pattern.test(source), `tools.ts matches ${String(pattern)}`).toBe(false);
    }
  });

  it('leaves the recorded history unchanged after a full sweep of tools', async () => {
    // `sentinel_compare` builds incidents in order to return them. It must not
    // record them: a tool call is not a decision to write to the operator's
    // history, and an assistant exploring the data must not leave marks.
    const before = await runCli(['incidents', '--json'], workspace);

    await probe.text('sentinel_compare', { before: 'before', after: 'after' });
    await probe.text('sentinel_report');

    const after = await runCli(['incidents', '--json'], workspace);
    const count = (text: string): number =>
      ((JSON.parse(text) as { incidents?: unknown[] }).incidents ?? []).length;

    expect(count(after.stdout)).toBe(count(before.stdout));
  }, 120_000);

  it('states the read-only boundary in the instructions a client receives', async () => {
    const response = await probe.send('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'security-tests', version: '1.0.0' },
    });

    const raw = response.result?.['instructions'];
    const instructions = typeof raw === 'string' ? raw : '';
    expect(instructions).toContain('read-only');
    expect(instructions).toContain('reach the network');
    expect(instructions).toContain('absence of a finding');
  });

  it('declares no capability beyond tools', async () => {
    const response = await probe.send('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
    const capabilities = response.result?.['capabilities'] as Record<string, unknown>;

    // Each additional capability is another surface. None of them is needed to
    // read a diagnosis.
    expect(Object.keys(capabilities)).toEqual(['tools']);
  });
});
