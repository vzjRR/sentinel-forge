import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXIT_CODES } from '@sentinel-forge/shared';
import { run } from './run.js';

function captureStream(): { stream: Writable; text: () => string } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer | string, _encoding, callback): void {
      chunks.push(chunk.toString());
      callback();
    },
  });
  return { stream, text: () => chunks.join('') };
}

interface RunResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function invoke(argv: readonly string[], cwd: string): Promise<RunResult> {
  const out = captureStream();
  const err = captureStream();
  const exitCode = await run({ argv, cwd, stdout: out.stream, stderr: err.stream });
  return { exitCode, stdout: out.text(), stderr: err.text() };
}

describe('CLI exit-code contract', () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), 'sentinel-cli-'));
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it('exits 0 for a successful command', async () => {
    const result = await invoke(['version'], workspace);
    expect(result.exitCode).toBe(EXIT_CODES.SUCCESS);
    expect(result.stdout).toContain('Sentinel Forge');
  });

  it('exits 2 for an unknown command and suggests the closest match', async () => {
    const result = await invoke(['helth'], workspace);
    expect(result.exitCode).toBe(EXIT_CODES.INVALID_INPUT);
    expect(result.stderr).toContain('sentinel health');
  });

  it('exits 2 for an unknown option', async () => {
    const result = await invoke(['version', '--colour'], workspace);
    expect(result.exitCode).toBe(EXIT_CODES.INVALID_INPUT);
    expect(result.stderr).toContain('Unknown option');
  });

  it('exits 2 for a command this build does not provide, and says which gate delivers it', async () => {
    const result = await invoke(['security'], workspace);
    expect(result.exitCode).toBe(EXIT_CODES.INVALID_INPUT);
    expect(result.stderr).toContain('NOT IMPLEMENTED');
    expect(result.stderr).toContain('GATE 4');
  });

  it('writes a parseable error object to stdout under --json', async () => {
    const result = await invoke(['security', '--json'], workspace);
    const payload = JSON.parse(result.stdout) as { ok: boolean; error: Record<string, unknown> };
    expect(payload.ok).toBe(false);
    expect(payload.error['exitCode']).toBe(EXIT_CODES.INVALID_INPUT);
    expect(payload.error['errorId']).toMatch(/^SF-/);
  });

  it('keeps stdout free of log output so pipelines stay parseable', async () => {
    const result = await invoke(['version', '--json', '--verbose'], workspace);
    expect(() => JSON.parse(result.stdout) as unknown).not.toThrow();
    expect(result.stderr).toContain('Running command.');
  });

  it('suppresses logs with --quiet but still writes the result', async () => {
    const result = await invoke(['version', '--quiet', '--verbose'], workspace);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('Sentinel Forge');
  });

  it('shows the overview when no command is given', async () => {
    const result = await invoke([], workspace);
    expect(result.exitCode).toBe(EXIT_CODES.SUCCESS);
    expect(result.stdout).toContain('Usage: sentinel <command>');
  });

  it('treats --version and --help as their corresponding commands', async () => {
    expect((await invoke(['--version'], workspace)).stdout).toContain('Product version');
    expect((await invoke(['--help'], workspace)).stdout).toContain('Usage: sentinel <command>');
  });

  it('shows command-specific help for `sentinel <command> --help`', async () => {
    const implemented = await invoke(['scan', '--help'], workspace);
    expect(implemented.exitCode).toBe(EXIT_CODES.SUCCESS);
    expect(implemented.stdout).toContain('sentinel scan');
    expect(implemented.stdout).not.toContain('NOT IMPLEMENTED');

    const planned = await invoke(['security', '--help'], workspace);
    expect(planned.stdout).toContain('NOT IMPLEMENTED');
    expect(planned.stdout).toContain('GATE 4');
  });

  it('lists the rule catalog with each rule delivery status', async () => {
    const result = await invoke(['help', 'rules', '--json'], workspace);
    const payload = JSON.parse(result.stdout) as { rules: { id: string; status: string }[] };
    expect(payload.rules.length).toBeGreaterThanOrEqual(15);
    expect(payload.rules.some((rule) => rule.id === 'PERF-LOOP-001')).toBe(true);
  });

  it('reports every documented exit code in help output', async () => {
    const result = await invoke(['help'], workspace);
    for (const code of ['0', '1', '2', '3', '4']) {
      expect(result.stdout).toContain(`  ${code}  `);
    }
  });
});

describe('CLI lifecycle commands', () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), 'sentinel-cli-'));
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it('initialises a workspace and is idempotent on a second run', async () => {
    const first = await invoke(['init', '--json'], workspace);
    expect(first.exitCode).toBe(EXIT_CODES.SUCCESS);
    const firstPayload = JSON.parse(first.stdout) as { configCreated: boolean; migrationsApplied: string[] };
    expect(firstPayload.configCreated).toBe(true);
    expect(firstPayload.migrationsApplied).toContain('0001_init.sql');

    const second = await invoke(['init', '--json'], workspace);
    const secondPayload = JSON.parse(second.stdout) as { configCreated: boolean; migrationsApplied: string[] };
    expect(second.exitCode).toBe(EXIT_CODES.SUCCESS);
    expect(secondPayload.configCreated).toBe(false);
    expect(secondPayload.migrationsApplied).toEqual([]);
  });

  it('refuses to initialise against a server path that does not exist', async () => {
    const result = await invoke(['init', '--server', path.join(workspace, 'nope')], workspace);
    expect(result.exitCode).toBe(EXIT_CODES.INVALID_INPUT);
    expect(result.stderr).toContain('Server path does not exist');
  });

  it('passes every environment check in an initialised workspace', async () => {
    await invoke(['init'], workspace);
    const result = await invoke(['doctor', '--json'], workspace);
    const payload = JSON.parse(result.stdout) as { summary: { failed: number } };
    expect(payload.summary.failed).toBe(0);
    expect(result.exitCode).toBe(EXIT_CODES.SUCCESS);
  });

  it('fails the environment check when the configured server path is unreadable', async () => {
    await invoke(['init'], workspace);
    const result = await invoke(['doctor', '--server', path.join(workspace, 'missing-server'), '--json'], workspace);
    const payload = JSON.parse(result.stdout) as { summary: { failed: number } };
    expect(payload.summary.failed).toBeGreaterThan(0);
    expect(result.exitCode).toBe(EXIT_CODES.INVALID_INPUT);
  });
});
