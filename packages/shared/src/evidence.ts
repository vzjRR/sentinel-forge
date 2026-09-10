/**
 * Evidence model.
 *
 * Every non-trivial finding must carry evidence. Evidence is what makes a
 * finding inspectable by a human: a file and line, an observed value, a
 * measured sample, a hash, or a relationship between resources.
 *
 * Evidence records are descriptive. They never assert causation.
 */

export const EVIDENCE_KINDS = [
  /** A location in a source or configuration file, optionally with an excerpt. */
  'FILE_REFERENCE',
  /** A matched textual/structural pattern (e.g. a loop construct). */
  'CODE_PATTERN',
  /** A configuration key and the value that was observed. */
  'CONFIG_VALUE',
  /** A relationship between two resources (depends-on, referenced-by, ...). */
  'RELATIONSHIP',
  /** A numeric measurement with a unit (e.g. milliseconds per tick). */
  'MEASUREMENT',
  /** A file integrity observation (hash, size, mtime). */
  'FILE_HASH',
  /** A line taken from a supplied log file. */
  'LOG_ENTRY',
  /** An observed runtime/state transition with a timestamp. */
  'RUNTIME_EVENT',
] as const;

export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export interface EvidenceLocation {
  /** Resource-relative or server-relative POSIX path. Never an absolute host path. */
  readonly file: string;
  /** 1-based line number when known. */
  readonly line?: number;
  /** 1-based column number when known. */
  readonly column?: number;
  /** Inclusive 1-based end line for multi-line evidence. */
  readonly endLine?: number;
}

export interface EvidenceMeasurement {
  readonly value: number;
  readonly unit: string;
  /** Number of samples the value was derived from, when applicable. */
  readonly sampleCount?: number;
  readonly baselineValue?: number;
}

export interface Evidence {
  readonly kind: EvidenceKind;
  /** Neutral, factual description of what was observed. */
  readonly description: string;
  readonly location?: EvidenceLocation;
  /**
   * Verbatim excerpt of the observed content. Excerpts pass through secret
   * redaction before they reach a report or the database.
   */
  readonly excerpt?: string;
  readonly measurement?: EvidenceMeasurement;
  /** ISO-8601 timestamp of the observation, when time-bound. */
  readonly observedAt?: string;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export function isEvidenceKind(value: unknown): value is EvidenceKind {
  return typeof value === 'string' && (EVIDENCE_KINDS as readonly string[]).includes(value);
}

/** Renders `path:line[:column]` for CLI and report output. */
export function formatEvidenceLocation(location: EvidenceLocation): string {
  if (location.line === undefined) return location.file;
  if (location.column === undefined) return `${location.file}:${location.line}`;
  return `${location.file}:${location.line}:${location.column}`;
}
