/**
 * `node:sqlite` driver.
 *
 * Uses the SQLite implementation bundled with Node (>= 22.5). This keeps the
 * product dependency-free at runtime and avoids a native compilation step on
 * operator machines, which is a frequent source of installation failure on
 * Windows FiveM hosts.
 *
 * Limitation: `node:sqlite` is marked experimental by Node and emits an
 * `ExperimentalWarning` on first use. The CLI routes that warning to the debug
 * log rather than the terminal; see docs/COMPATIBILITY.md.
 */

import { DatabaseSync } from 'node:sqlite';
import { SentinelInternalError } from '../errors.js';
import type { DatabaseDriver, PreparedStatement, RunResult, SqlValue } from './driver.js';

type SqliteBindValue = null | number | bigint | string | Uint8Array;

/** `node:sqlite` has no boolean binding; SQLite stores booleans as integers. */
function toBindValue(value: SqlValue): SqliteBindValue {
  return typeof value === 'boolean' ? (value ? 1 : 0) : value;
}

class NodeSqliteStatement implements PreparedStatement {
  readonly #statement: ReturnType<DatabaseSync['prepare']>;

  constructor(statement: ReturnType<DatabaseSync['prepare']>) {
    this.#statement = statement;
  }

  all<T = Record<string, SqlValue>>(...parameters: readonly SqlValue[]): T[] {
    return this.#statement.all(...parameters.map(toBindValue)) as T[];
  }

  get<T = Record<string, SqlValue>>(...parameters: readonly SqlValue[]): T | undefined {
    return this.#statement.get(...parameters.map(toBindValue)) as T | undefined;
  }

  run(...parameters: readonly SqlValue[]): RunResult {
    const result = this.#statement.run(...parameters.map(toBindValue));
    return { changes: Number(result.changes), lastInsertRowid: result.lastInsertRowid };
  }
}

export interface NodeSqliteDriverOptions {
  /** File path, or `:memory:` for an ephemeral database (tests). */
  readonly location: string;
  /**
   * Write-ahead logging. Enabled for file databases: it keeps a long scan write
   * from blocking a concurrent read by the dashboard or a second CLI process.
   */
  readonly walMode?: boolean;
}

export class NodeSqliteDriver implements DatabaseDriver {
  readonly kind = 'node:sqlite';
  readonly location: string;

  readonly #database: DatabaseSync;
  #open = true;
  #transactionDepth = 0;

  constructor(options: NodeSqliteDriverOptions) {
    this.location = options.location;
    try {
      this.#database = new DatabaseSync(options.location);
    } catch (error) {
      throw new SentinelInternalError('The local database could not be opened.', {
        cause: error,
        remediation: 'Check that the database directory exists and is writable.',
        details: { location: options.location },
      });
    }

    // Foreign keys are off by default in SQLite and must be enabled per connection.
    this.#database.exec('PRAGMA foreign_keys = ON');
    if (options.walMode !== false && options.location !== ':memory:') {
      this.#database.exec('PRAGMA journal_mode = WAL');
    }
    this.#database.exec('PRAGMA busy_timeout = 5000');
  }

  get open(): boolean {
    return this.#open;
  }

  exec(sql: string): void {
    this.#assertOpen();
    this.#database.exec(sql);
  }

  prepare(sql: string): PreparedStatement {
    this.#assertOpen();
    return new NodeSqliteStatement(this.#database.prepare(sql));
  }

  transaction<T>(work: () => T): T {
    this.#assertOpen();
    const depth = this.#transactionDepth;
    const savepoint = `sf_sp_${String(depth)}`;

    this.#database.exec(depth === 0 ? 'BEGIN' : `SAVEPOINT ${savepoint}`);
    this.#transactionDepth = depth + 1;

    try {
      const result = work();
      this.#database.exec(depth === 0 ? 'COMMIT' : `RELEASE ${savepoint}`);
      return result;
    } catch (error) {
      this.#database.exec(depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${savepoint}`);
      throw error;
    } finally {
      this.#transactionDepth = depth;
    }
  }

  close(): void {
    if (!this.#open) return;
    this.#database.close();
    this.#open = false;
  }

  #assertOpen(): void {
    if (!this.#open) {
      throw new SentinelInternalError('Attempted to use the local database after it was closed.');
    }
  }
}
