/**
 * Error model.
 *
 * Two classes of failure are distinguished:
 *
 *  - *Expected* failures (`SentinelUserError`) are the operator's to fix. They
 *    carry a plain message and, where possible, a concrete remediation hint.
 *  - *Unexpected* failures (`SentinelInternalError`) carry a short error id so
 *    a user can reference the incident without pasting a stack trace that may
 *    contain sensitive paths.
 *
 * No error message may contain a secret value. All messages pass through
 * redaction before they are rendered or logged.
 */

import { randomBytes } from 'node:crypto';
import { EXIT_CODES, type ExitCode } from '@sentinel-forge/shared';
import { redactText } from './logging/redaction.js';

export type ErrorCategory = 'USER' | 'CONFIG' | 'SECURITY' | 'INTERNAL' | 'NOT_IMPLEMENTED';

export interface SentinelErrorOptions {
  readonly cause?: unknown;
  /** Concrete next step for the operator, e.g. an example command. */
  readonly remediation?: string;
  /** Non-sensitive structured context included in `--json` output. */
  readonly details?: Readonly<Record<string, string | number | boolean>>;
}

/** Generates a short, non-guessable id used to correlate a report with a log line. */
export function newErrorId(): string {
  return `SF-${randomBytes(4).toString('hex').toUpperCase()}`;
}

export abstract class SentinelError extends Error {
  abstract readonly category: ErrorCategory;
  abstract readonly exitCode: ExitCode;

  readonly errorId: string;
  readonly remediation?: string;
  readonly details?: Readonly<Record<string, string | number | boolean>>;

  protected constructor(message: string, options: SentinelErrorOptions = {}) {
    super(redactText(message), options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.errorId = newErrorId();
    if (options.remediation !== undefined) this.remediation = redactText(options.remediation);
    if (options.details !== undefined) this.details = options.details;
  }

  /** Safe, serializable representation for `--json` output. */
  toJSON(): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      errorId: this.errorId,
      category: this.category,
      message: this.message,
      exitCode: this.exitCode,
    };
    if (this.remediation !== undefined) payload['remediation'] = this.remediation;
    if (this.details !== undefined) payload['details'] = this.details;
    return payload;
  }
}

/** An operator-facing problem: bad path, unreadable file, unusable argument. */
export class SentinelUserError extends SentinelError {
  override readonly category: ErrorCategory = 'USER';
  override readonly exitCode: ExitCode = EXIT_CODES.INVALID_INPUT;

  constructor(message: string, options?: SentinelErrorOptions) {
    super(message, options);
  }
}

/** Invalid or unusable configuration. */
export class SentinelConfigError extends SentinelError {
  override readonly category: ErrorCategory = 'CONFIG';
  override readonly exitCode: ExitCode = EXIT_CODES.INVALID_INPUT;

  constructor(message: string, options?: SentinelErrorOptions) {
    super(message, options);
  }
}

/**
 * A security boundary was reached: a path escaped its root, a symlink pointed
 * outside the permitted tree, or redaction could not be guaranteed. These are
 * always fatal — Sentinel Forge stops rather than proceeding unsafely.
 */
export class SentinelSecurityError extends SentinelError {
  override readonly category: ErrorCategory = 'SECURITY';
  override readonly exitCode: ExitCode = EXIT_CODES.SECURITY_FAILURE;

  constructor(message: string, options?: SentinelErrorOptions) {
    super(message, options);
  }
}

/** An unexpected failure. The message must stay free of raw system detail. */
export class SentinelInternalError extends SentinelError {
  override readonly category: ErrorCategory = 'INTERNAL';
  override readonly exitCode: ExitCode = EXIT_CODES.INTERNAL_ERROR;

  constructor(message: string, options?: SentinelErrorOptions) {
    super(message, options);
  }
}

/**
 * A capability that is declared in the product specification but is not part of
 * this build. Reported honestly rather than silently succeeding.
 */
export class SentinelNotImplementedError extends SentinelError {
  override readonly category: ErrorCategory = 'NOT_IMPLEMENTED';
  override readonly exitCode: ExitCode = EXIT_CODES.INVALID_INPUT;

  readonly targetGate: number;

  constructor(capability: string, targetGate: number, options?: SentinelErrorOptions) {
    super(`${capability} is NOT IMPLEMENTED in this build (planned for GATE ${targetGate}).`, options);
    this.targetGate = targetGate;
  }

  override toJSON(): Record<string, unknown> {
    return { ...super.toJSON(), targetGate: this.targetGate };
  }
}

export function isSentinelError(value: unknown): value is SentinelError {
  return value instanceof SentinelError;
}

/**
 * Normalizes anything thrown into a `SentinelError`, so top-level handlers
 * always have an error id, a category and an exit code to work with.
 */
export function toSentinelError(value: unknown): SentinelError {
  if (isSentinelError(value)) return value;
  if (value instanceof Error) {
    return new SentinelInternalError(value.message, { cause: value });
  }
  return new SentinelInternalError(`Unexpected non-error value thrown: ${String(value)}`);
}
