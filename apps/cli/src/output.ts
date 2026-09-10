/**
 * Command output.
 *
 * stdout carries results only; logs and diagnostics go to stderr. That split is
 * what makes `sentinel <command> --json | jq` reliable in a pipeline.
 *
 * Every command produces both a text rendering and a JSON payload, so `--json`
 * never returns less information than the human-readable form.
 */

import type { Writable } from 'node:stream';
import { type ExitCode, EXIT_CODES } from '@sentinel-forge/shared';

export interface CommandOutcome {
  readonly exitCode: ExitCode;
  /** Human-readable rendering. */
  readonly text: string;
  /** Machine-readable payload, emitted under `--json`. */
  readonly data: Record<string, unknown>;
}

export function ok(text: string, data: Record<string, unknown> = {}): CommandOutcome {
  return { exitCode: EXIT_CODES.SUCCESS, text, data };
}

export function withFindings(text: string, data: Record<string, unknown>): CommandOutcome {
  return { exitCode: EXIT_CODES.FINDINGS, text, data };
}

export interface WriteOutcomeOptions {
  readonly json: boolean;
  readonly command: string;
  readonly stdout: Writable;
}

/** Writes a successful outcome to stdout in the requested representation. */
export function writeOutcome(outcome: CommandOutcome, options: WriteOutcomeOptions): void {
  if (options.json) {
    const payload = {
      ok: true,
      command: options.command,
      exitCode: outcome.exitCode,
      ...outcome.data,
    };
    options.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  if (outcome.text.length > 0) {
    options.stdout.write(`${outcome.text}\n`);
  }
}

export interface ErrorPayload {
  readonly errorId: string;
  readonly category: string;
  readonly message: string;
  readonly exitCode: number;
  readonly remediation?: string;
  readonly details?: Record<string, unknown>;
}

/** Writes a failure. JSON goes to stdout so pipelines can parse it; text to stderr. */
export function writeError(
  payload: ErrorPayload,
  options: { readonly json: boolean; readonly command: string; readonly stdout: Writable; readonly stderr: Writable },
): void {
  if (options.json) {
    options.stdout.write(
      `${JSON.stringify({ ok: false, command: options.command, error: payload }, null, 2)}\n`,
    );
    return;
  }

  const lines = [`Error: ${payload.message}`];
  if (payload.remediation !== undefined) lines.push('', payload.remediation);
  lines.push('', `Error id: ${payload.errorId}`);
  options.stderr.write(`${lines.join('\n')}\n`);
}

/** Fixed-width two-column layout used by help and status output. */
export function formatTable(rows: readonly (readonly [string, string])[], indent = '  '): string {
  const width = rows.reduce((widest, [left]) => Math.max(widest, left.length), 0);
  return rows.map(([left, right]) => `${indent}${left.padEnd(width)}  ${right}`).join('\n');
}
