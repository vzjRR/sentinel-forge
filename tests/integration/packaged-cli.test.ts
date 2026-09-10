/**
 * Integration: the packaged executable.
 *
 * Everything else exercises the CLI in-process. This suite runs the built
 * `dist/bin/sentinel.js` as a real subprocess, which is the only way to verify
 * the shebang entry point, the process exit code, and that the expected
 * ExperimentalWarning for `node:sqlite` does not reach the operator's terminal.
 *
 * Skipped when the project has not been built; `npm run verify` builds first.
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXIT_CODES } from '@sentinel-forge/shared';
import { createWorkspace, removeWorkspace, repositoryRoot } from '../helpers/workspace.js';

const execFileAsync = promisify(execFile);
const binary = path.join(repositoryRoot, 'apps', 'cli', 'dist', 'bin', 'sentinel.js');
const built = existsSync(binary);

interface ExecResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function runBinary(args: readonly string[], cwd: string): Promise<ExecResult> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [binary, ...args], { cwd });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failure.code ?? 1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
  }
}

describe.skipIf(!built)('packaged CLI', () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await createWorkspace('sentinel-bin-');
  });

  afterEach(async () => {
    await removeWorkspace(workspace);
  });

  it('exits 0 and prints the version', async () => {
    const result = await runBinary(['version'], workspace);
    expect(result.code).toBe(EXIT_CODES.SUCCESS);
    expect(result.stdout).toContain('Sentinel Forge');
  });

  it('exits 2 for a command that is not in this build', async () => {
    const result = await runBinary(['scan'], workspace);
    expect(result.code).toBe(EXIT_CODES.INVALID_INPUT);
  });

  it('initialises a workspace as a subprocess and keeps the SQLite warning off the terminal', async () => {
    const result = await runBinary(['init'], workspace);
    expect(result.code).toBe(EXIT_CODES.SUCCESS);
    expect(result.stderr).not.toContain('ExperimentalWarning');
    expect(existsSync(path.join(workspace, '.sentinel', 'sentinel.db'))).toBe(true);
  });

  it('emits only JSON on stdout under --json', async () => {
    const result = await runBinary(['doctor', '--json'], workspace);
    expect(() => JSON.parse(result.stdout) as unknown).not.toThrow();
  });
});
