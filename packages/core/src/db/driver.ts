/**
 * Database driver interface.
 *
 * Sentinel Forge stores diagnostic history locally in SQLite. The engine is
 * behind an interface for one practical reason: the current implementation uses
 * `node:sqlite`, which is bundled with Node (no native build step, no
 * dependency, no licence question) but is still marked experimental. Should it
 * change or need replacing with a compiled binding, only the driver changes.
 *
 * The interface is synchronous because every supported backend is synchronous
 * and because scan writes happen in short, well-defined transactions.
 */

export type SqlValue = string | number | bigint | boolean | null | Uint8Array;

export interface RunResult {
  /** Rows changed by the statement. */
  readonly changes: number;
  /** Rowid inserted by the statement, when the table has one. */
  readonly lastInsertRowid: number | bigint;
}

export interface PreparedStatement {
  /** Executes and returns every row. */
  all<T = Record<string, SqlValue>>(...parameters: readonly SqlValue[]): T[];
  /** Executes and returns the first row, or `undefined`. */
  get<T = Record<string, SqlValue>>(...parameters: readonly SqlValue[]): T | undefined;
  /** Executes a statement that returns no rows. */
  run(...parameters: readonly SqlValue[]): RunResult;
}

export interface DatabaseDriver {
  /** Identifies the backing implementation, e.g. `node:sqlite`. */
  readonly kind: string;
  /** Absolute path of the database file, or `:memory:`. */
  readonly location: string;

  /** Executes one or more statements with no parameters (DDL, pragmas). */
  exec(sql: string): void;
  prepare(sql: string): PreparedStatement;
  /**
   * Runs `work` inside a transaction, committing on return and rolling back if
   * it throws. Nested calls join the outer transaction via savepoints.
   */
  transaction<T>(work: () => T): T;
  close(): void;
  readonly open: boolean;
}
