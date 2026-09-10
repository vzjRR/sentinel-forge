/**
 * Structured logging.
 *
 * Two output modes:
 *   - `pretty`  human-readable, for interactive terminal use;
 *   - `json`    one JSON object per line, for automation and log shipping.
 *
 * All log output is written to stderr so that stdout stays reserved for
 * command results (`--json` payloads, report content). Every record passes
 * through {@link redactValue} before it is written.
 */

import type { Writable } from 'node:stream';
import { redactText, redactValue } from './redaction.js';

export const LOG_LEVELS = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'SILENT'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const LEVEL_RANK: Readonly<Record<LogLevel, number>> = Object.freeze({
  DEBUG: 10,
  INFO: 20,
  WARN: 30,
  ERROR: 40,
  SILENT: 100,
});

export function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === 'string' && (LOG_LEVELS as readonly string[]).includes(value);
}

export type LogFormat = 'pretty' | 'json';

export type LogContext = Record<string, unknown>;

export interface LogRecord {
  readonly timestamp: string;
  readonly level: Exclude<LogLevel, 'SILENT'>;
  readonly message: string;
  readonly context?: LogContext;
}

export interface LoggerOptions {
  readonly level?: LogLevel;
  readonly format?: LogFormat;
  /** Defaults to `process.stderr`. Injectable for tests. */
  readonly stream?: Writable;
  /** Context merged into every record emitted by this logger. */
  readonly context?: LogContext;
  /** Clock injection keeps log assertions deterministic in tests. */
  readonly now?: () => Date;
}

export interface Logger {
  readonly level: LogLevel;
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  /** Returns a logger that merges `context` into every subsequent record. */
  child(context: LogContext): Logger;
  isLevelEnabled(level: Exclude<LogLevel, 'SILENT'>): boolean;
}

const LEVEL_LABEL: Readonly<Record<Exclude<LogLevel, 'SILENT'>, string>> = Object.freeze({
  DEBUG: 'debug',
  INFO: 'info ',
  WARN: 'warn ',
  ERROR: 'error',
});

class StructuredLogger implements Logger {
  readonly level: LogLevel;

  readonly #format: LogFormat;
  readonly #stream: Writable;
  readonly #context: LogContext;
  readonly #now: () => Date;

  constructor(options: LoggerOptions = {}) {
    this.level = options.level ?? 'INFO';
    this.#format = options.format ?? 'pretty';
    this.#stream = options.stream ?? process.stderr;
    this.#context = options.context ?? {};
    this.#now = options.now ?? ((): Date => new Date());
  }

  isLevelEnabled(level: Exclude<LogLevel, 'SILENT'>): boolean {
    return LEVEL_RANK[level] >= LEVEL_RANK[this.level];
  }

  debug(message: string, context?: LogContext): void {
    this.#write('DEBUG', message, context);
  }

  info(message: string, context?: LogContext): void {
    this.#write('INFO', message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.#write('WARN', message, context);
  }

  error(message: string, context?: LogContext): void {
    this.#write('ERROR', message, context);
  }

  child(context: LogContext): Logger {
    return new StructuredLogger({
      level: this.level,
      format: this.#format,
      stream: this.#stream,
      context: { ...this.#context, ...context },
      now: this.#now,
    });
  }

  #write(level: Exclude<LogLevel, 'SILENT'>, message: string, context?: LogContext): void {
    if (!this.isLevelEnabled(level)) return;

    const merged: LogContext = { ...this.#context, ...(context ?? {}) };
    const record: LogRecord = {
      timestamp: this.#now().toISOString(),
      level,
      message: redactText(message),
      ...(Object.keys(merged).length > 0 ? { context: redactValue(merged) } : {}),
    };

    this.#stream.write(this.#format === 'json' ? `${JSON.stringify(record)}\n` : `${formatPretty(record)}\n`);
  }
}

function formatPretty(record: LogRecord): string {
  const head = `${record.timestamp} ${LEVEL_LABEL[record.level]} ${record.message}`;
  if (record.context === undefined) return head;
  const pairs = Object.entries(record.context)
    .map(([key, value]) => `${key}=${formatContextValue(value)}`)
    .join(' ');
  return pairs.length > 0 ? `${head} ${pairs}` : head;
}

function formatContextValue(value: unknown): string {
  // Every branch is explicit: a context value that renders as "[object Object]"
  // makes a log line useless exactly when it is being read to diagnose something.
  switch (typeof value) {
    case 'string':
      return value.includes(' ') ? JSON.stringify(value) : value;
    case 'number':
    case 'boolean':
      return String(value);
    case 'bigint':
      return `${value.toString()}n`;
    case 'undefined':
      return 'undefined';
    case 'symbol':
      return value.toString();
    case 'function':
      return '[function]';
    case 'object':
      if (value === null) return 'null';
      try {
        return JSON.stringify(value) ?? '[unserializable]';
      } catch {
        return '[unserializable]';
      }
    default:
      return '[unknown]';
  }
}

export function createLogger(options: LoggerOptions = {}): Logger {
  return new StructuredLogger(options);
}

/** A logger that discards everything. Useful in tests and library contexts. */
export function createSilentLogger(): Logger {
  return createLogger({ level: 'SILENT' });
}
