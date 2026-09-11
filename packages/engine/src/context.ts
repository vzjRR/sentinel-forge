/**
 * The analysis context: one scan, cached, plus the recorded history.
 *
 * Both applications need the same two things, and neither should implement them
 * twice: the dashboard renders them as pages, the MCP server returns them as
 * tool results. Anything either one adds on top of this — how to bind a socket,
 * how to frame a JSON-RPC message — belongs to that application, not here.
 *
 * Two sources, deliberately kept distinct:
 *
 *   - **A scan**, run by this process, giving the current state of the server
 *     on disk. It is cached, because scanning a large server on every request
 *     would make the diagnostic tool a load source of its own.
 *   - **The local database**, giving what was recorded over time: baselines,
 *     incidents, integrity snapshots and imported runtime telemetry.
 *
 * Every consumer states which of the two it is showing and when that data was
 * produced. An interface that presents a five-minute-old scan as though it were
 * live is telling the operator something untrue, and they will make a decision
 * on it.
 *
 * Nothing here writes to the FiveM server. The scan reads; the database writes
 * are Sentinel Forge's own history.
 *
 * © 2026 Talal Al Ghafri. All Rights Reserved.
 */

import {
  findServerByPath,
  openDatabase,
  type Clock,
  type LoadedConfig,
  type Logger,
  type OpenedDatabase,
} from '@sentinel-forge/core';
import { persistScan, scanServer, type ScanResult } from './scan.js';
import { listIncidents, type StoredIncident } from '@sentinel-forge/incidents';
import { listSnapshots, type IntegritySnapshot } from '@sentinel-forge/integrity';
import { listBaselines, type BaselineRecord } from '@sentinel-forge/performance';
import { loadRuntimeEvents, readStoredRuntimeState, type StoredRuntimeEvent, type StoredRuntimeState } from '@sentinel-forge/runtime';

export interface AnalysisContextOptions {
  readonly loaded: LoadedConfig;
  readonly serverPath: string;
  readonly databasePath: string;
  readonly clock: Clock;
  readonly logger: Logger;
  /**
   * Milliseconds a scan result stays usable. `0` scans once at startup and
   * never again, which is what an operator inspecting a frozen moment wants.
   */
  readonly refreshIntervalMs: number;
  /** Command name recorded with each scan, e.g. `dashboard` or `mcp`. */
  readonly command: string;
}

export interface CachedScan {
  readonly result: ScanResult;
  /** When this scan ran. Rendered on every page. */
  readonly at: Date;
  readonly durationMs: number;
}

/** History read from the local database. Empty is a real answer, not a failure. */
export interface StoredHistory {
  readonly serverId?: string;
  readonly baselines: readonly BaselineRecord[];
  readonly incidents: readonly StoredIncident[];
  readonly snapshots: readonly IntegritySnapshot[];
  readonly runtime?: StoredRuntimeState;
  readonly runtimeEvents: readonly StoredRuntimeEvent[];
  /**
   * Set when the database could not be read. The dashboard then says the
   * history is unavailable rather than rendering an empty history, which would
   * read as "nothing has ever been recorded".
   */
  readonly unavailableReason?: string;
}

export class AnalysisContext {
  private cached: CachedScan | undefined;
  /** In-flight scan, shared so concurrent requests do not each start one. */
  private pending: Promise<CachedScan> | undefined;

  constructor(private readonly options: AnalysisContextOptions) {}

  get serverPath(): string {
    return this.options.serverPath;
  }

  get databasePath(): string {
    return this.options.databasePath;
  }

  get config(): LoadedConfig {
    return this.options.loaded;
  }

  get refreshIntervalMs(): number {
    return this.options.refreshIntervalMs;
  }

  /** When the cached scan was produced, or `undefined` before the first scan. */
  get scannedAt(): Date | undefined {
    return this.cached?.at;
  }

  /**
   * Returns a scan, running one only when the cache is absent or stale.
   *
   * Concurrent callers share one scan. Without that, a browser requesting
   * several pages at once, or an assistant calling several tools at once, would
   * each start a scan of the same server.
   */
  async scan(): Promise<CachedScan> {
    const cached = this.cached;
    if (cached !== undefined && !this.isStale(cached)) return cached;
    if (this.pending !== undefined) return this.pending;

    this.pending = this.runScan().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }

  private isStale(cached: CachedScan): boolean {
    if (this.options.refreshIntervalMs <= 0) return false;
    return this.options.clock.now().getTime() - cached.at.getTime() >= this.options.refreshIntervalMs;
  }

  private async runScan(): Promise<CachedScan> {
    const { config } = this.options.loaded;
    const startedAt = this.options.clock.monotonicMs();

    const result = await scanServer({
      serverPath: this.options.serverPath,
      resourceDirectories: config.server.resourceDirectories,
      maxDepth: config.scan.maxDepth,
      maxFiles: config.scan.maxFiles,
      maxFileBytes: config.scan.maxFileBytes,
      followSymlinks: config.scan.followSymlinks,
      skipDirectories: config.scan.skipDirectories,
      minimumSeverity: config.analysis.minimumSeverity,
      disabledRules: config.analysis.disabledRules,
      clock: this.options.clock,
      logger: this.options.logger,
      command: this.options.command,
    });

    // The scan is recorded like any other, so an application does not create a
    // parallel history the CLI cannot see. A storage failure is logged and does
    // not fail the request: the diagnosis is already in hand.
    this.withDatabase((database) => {
      persistScan(database.driver, result, this.options.command);
    }, 'Scan could not be recorded in the local database.');

    const cached: CachedScan = {
      result,
      at: this.options.clock.now(),
      durationMs: this.options.clock.monotonicMs() - startedAt,
    };
    this.cached = cached;
    return cached;
  }

  /** Reads recorded history. A database that cannot be opened yields a reason. */
  history(): StoredHistory {
    let database: OpenedDatabase | undefined;
    try {
      database = openDatabase({ location: this.options.databasePath, logger: this.options.logger });
      const server = findServerByPath(database.driver, this.options.serverPath);

      if (server === undefined) {
        return { baselines: [], incidents: [], snapshots: [], runtimeEvents: [] };
      }

      return {
        serverId: server.id,
        baselines: listBaselines(database.driver, server.id),
        incidents: listIncidents(database.driver, server.id, 50),
        snapshots: listSnapshots(database.driver, server.id, 50),
        runtime: readStoredRuntimeState(database.driver, server.id),
        runtimeEvents: loadRuntimeEvents(database.driver, server.id, 100),
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown error';
      this.options.logger.warn('Recorded history could not be read.', { error: reason });
      return {
        baselines: [],
        incidents: [],
        snapshots: [],
        runtimeEvents: [],
        unavailableReason: reason,
      };
    } finally {
      database?.close();
    }
  }

  private withDatabase(work: (database: OpenedDatabase) => void, failureMessage: string): void {
    let database: OpenedDatabase | undefined;
    try {
      database = openDatabase({ location: this.options.databasePath, logger: this.options.logger });
      work(database);
    } catch (error) {
      this.options.logger.warn(failureMessage, {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      database?.close();
    }
  }
}
