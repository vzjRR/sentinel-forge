/**
 * Bounded directory traversal.
 *
 * Traversal limits are safety limits, not performance tuning: an unbounded walk
 * over a server directory containing a symlink loop or a deep cache tree will
 * not terminate. Limits are explicit and every stop reason is reported so the
 * caller can surface "analysis was incomplete" instead of silently under-reporting.
 */

import { opendir, stat } from 'node:fs/promises';
import path from 'node:path';
import { isPathInside, realPathOrNearest, toRootRelative } from './paths.js';

export interface WalkOptions {
  /** Maximum directory depth below the root. Default 24. */
  readonly maxDepth?: number;
  /** Maximum number of entries to yield. Default 200_000. */
  readonly maxEntries?: number;
  /**
   * Directory names skipped wherever they appear. Defaults cover version
   * control metadata and dependency/caches directories that carry no
   * diagnostic value but dominate traversal cost.
   */
  readonly skipDirectories?: readonly string[];
  /**
   * When `false` (default), symlinked directories are not descended into and
   * symlinked files are not followed. Enabling this is only safe within a root
   * the operator fully controls.
   */
  readonly followSymlinks?: boolean;
}

export const DEFAULT_SKIP_DIRECTORIES: readonly string[] = Object.freeze([
  '.git',
  '.svn',
  '.hg',
  'node_modules',
  '.cache',
  'cache',
  '.sentinel',
]);

export type WalkStopReason = 'COMPLETED' | 'MAX_ENTRIES_REACHED';

export interface WalkedFile {
  /** Absolute path on the host. Not written to reports. */
  readonly absolutePath: string;
  /** Root-relative POSIX path. Safe for reports. */
  readonly relativePath: string;
  readonly size: number;
  readonly modifiedAt: Date;
}

export interface WalkResult {
  readonly files: readonly WalkedFile[];
  readonly directoriesVisited: number;
  readonly stopReason: WalkStopReason;
  /** Paths skipped, with the reason. Reported so gaps in analysis stay visible. */
  readonly skipped: readonly { readonly path: string; readonly reason: string }[];
}

/**
 * Walks `root` breadth-first, returning regular files only.
 *
 * Unreadable directories are recorded in `skipped` rather than aborting the
 * walk: a permission error on one resource must not prevent analysis of the
 * rest of the server.
 */
export async function walkDirectory(root: string, options: WalkOptions = {}): Promise<WalkResult> {
  const {
    maxDepth = 24,
    maxEntries = 200_000,
    skipDirectories = DEFAULT_SKIP_DIRECTORIES,
    followSymlinks = false,
  } = options;

  const realRoot = realPathOrNearest(root);
  const skipSet = new Set(skipDirectories.map((name) => name.toLowerCase()));
  const files: WalkedFile[] = [];
  const skipped: { path: string; reason: string }[] = [];
  const visitedDirectories = new Set<string>();
  const queue: { readonly absolutePath: string; readonly depth: number }[] = [{ absolutePath: realRoot, depth: 0 }];
  let stopReason: WalkStopReason = 'COMPLETED';

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;

    if (visitedDirectories.has(current.absolutePath)) continue;
    visitedDirectories.add(current.absolutePath);

    let dir;
    try {
      dir = await opendir(current.absolutePath);
    } catch (error) {
      skipped.push({
        path: toRootRelative(realRoot, current.absolutePath),
        reason: `Directory could not be read (${(error as NodeJS.ErrnoException).code ?? 'unknown error'}).`,
      });
      continue;
    }

    try {
      for await (const entry of dir) {
        const entryPath = path.join(current.absolutePath, entry.name);

        if (entry.isSymbolicLink() && !followSymlinks) {
          skipped.push({
            path: toRootRelative(realRoot, entryPath),
            reason: 'Symbolic link not followed (symlink traversal is disabled).',
          });
          continue;
        }

        if (entry.isDirectory()) {
          if (skipSet.has(entry.name.toLowerCase())) continue;
          if (current.depth + 1 > maxDepth) {
            skipped.push({
              path: toRootRelative(realRoot, entryPath),
              reason: `Maximum traversal depth of ${maxDepth} reached.`,
            });
            continue;
          }
          const realEntry = followSymlinks ? realPathOrNearest(entryPath) : entryPath;
          if (!isPathInside(realRoot, realEntry)) {
            skipped.push({
              path: toRootRelative(realRoot, entryPath),
              reason: 'Entry resolves outside the scanned root.',
            });
            continue;
          }
          queue.push({ absolutePath: realEntry, depth: current.depth + 1 });
          continue;
        }

        if (!entry.isFile()) {
          skipped.push({
            path: toRootRelative(realRoot, entryPath),
            reason: 'Not a regular file.',
          });
          continue;
        }

        if (files.length >= maxEntries) {
          stopReason = 'MAX_ENTRIES_REACHED';
          break;
        }

        try {
          const stats = await stat(entryPath);
          files.push({
            absolutePath: entryPath,
            relativePath: toRootRelative(realRoot, entryPath),
            size: stats.size,
            modifiedAt: stats.mtime,
          });
        } catch (error) {
          skipped.push({
            path: toRootRelative(realRoot, entryPath),
            reason: `File metadata unavailable (${(error as NodeJS.ErrnoException).code ?? 'unknown error'}).`,
          });
        }
      }
    } finally {
      await dir.close().catch(() => undefined);
    }

    if (stopReason === 'MAX_ENTRIES_REACHED') break;
  }

  return {
    files,
    directoriesVisited: visitedDirectories.size,
    stopReason,
    skipped,
  };
}
