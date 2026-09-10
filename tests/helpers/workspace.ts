/**
 * Test helpers for creating throwaway workspaces and invoking the CLI.
 *
 * Kept out of the packages so that no test-only code can be imported by
 * production modules.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Writable } from 'node:stream';
import { run } from '@sentinel-forge/cli';

export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const fixturesRoot = path.join(repositoryRoot, 'tests', 'fixtures');

export function fixturePath(...segments: string[]): string {
  return path.join(fixturesRoot, ...segments);
}

export async function createWorkspace(prefix = 'sentinel-test-'): Promise<string> {
  return mkdtemp(path.join(tmpdir(), prefix));
}

export async function removeWorkspace(workspace: string): Promise<void> {
  await rm(workspace, { recursive: true, force: true });
}

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

export interface CliResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Invokes the CLI in-process with captured streams. */
export async function runCli(argv: readonly string[], cwd: string): Promise<CliResult> {
  const out = captureStream();
  const err = captureStream();
  const exitCode = await run({ argv, cwd, stdout: out.stream, stderr: err.stream });
  return { exitCode, stdout: out.text(), stderr: err.text() };
}

export function parseJsonOutput<T>(result: CliResult): T {
  return JSON.parse(result.stdout) as T;
}
