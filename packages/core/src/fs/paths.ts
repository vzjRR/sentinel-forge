/**
 * Path containment.
 *
 * Sentinel Forge reads paths that come from untrusted content: manifest
 * declarations, configuration values, glob results and log lines. Every one of
 * them is resolved against an explicit root and rejected if it escapes.
 *
 * The containment procedure is:
 *   1. resolve the candidate to an absolute path,
 *   2. resolve the *real* path, following symlinks as far as the filesystem
 *      allows (walking up to the nearest existing ancestor when the target does
 *      not exist yet),
 *   3. verify the result is the root itself or a descendant of it,
 *   4. reject otherwise.
 *
 * Step 2 is what defends against symlink escapes; a purely lexical check is
 * not sufficient because `resources/evil -> /etc` normalizes cleanly.
 */

import { realpathSync } from 'node:fs';
import path from 'node:path';
import { SentinelSecurityError } from '../errors.js';

/** Converts a filesystem path to a POSIX-separated form for stable reporting. */
export function toPosixPath(value: string): string {
  return value.split(path.sep).join('/');
}

/** True on platforms whose filesystem paths are conventionally case-insensitive. */
function isCaseInsensitiveFs(): boolean {
  return process.platform === 'win32' || process.platform === 'darwin';
}

function comparablePath(value: string): string {
  return isCaseInsensitiveFs() ? value.toLowerCase() : value;
}

/**
 * Lexical containment test on two already-absolute paths.
 * Does not touch the filesystem — use {@link resolveWithinRoot} for real input.
 */
export function isPathInside(root: string, candidate: string): boolean {
  const normalizedRoot = comparablePath(path.resolve(root));
  const normalizedCandidate = comparablePath(path.resolve(candidate));
  if (normalizedCandidate === normalizedRoot) return true;
  const relative = path.relative(normalizedRoot, normalizedCandidate);
  return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/**
 * Resolves symlinks for `target`, tolerating a path that does not exist yet by
 * resolving the deepest existing ancestor and re-appending the remainder.
 */
export function realPathOrNearest(target: string): string {
  let current = path.resolve(target);
  const trailing: string[] = [];

  // Bounded by path depth; `path.dirname` is a fixed point at the filesystem root.
  for (;;) {
    try {
      const resolved = realpathSync(current);
      return trailing.length === 0 ? resolved : path.join(resolved, ...trailing.reverse());
    } catch {
      const parent = path.dirname(current);
      if (parent === current) {
        // Reached the filesystem root without finding an existing ancestor.
        return path.resolve(target);
      }
      trailing.push(path.basename(current));
      current = parent;
    }
  }
}

export interface ResolveWithinRootOptions {
  /**
   * When `false`, symlinks are not resolved and only a lexical check is run.
   * Only use this for paths that are known not to exist yet *and* that will not
   * be opened. Defaults to `true`.
   */
  readonly followSymlinks?: boolean;
  /** Description of the value's origin, included in the error message. */
  readonly label?: string;
}

/**
 * Resolves `candidate` (absolute or relative to `root`) and guarantees the
 * result stays inside `root`.
 *
 * @throws {SentinelSecurityError} when the path escapes the root, either
 *   lexically (`../`, absolute path outside the root) or through a symlink.
 */
export function resolveWithinRoot(root: string, candidate: string, options: ResolveWithinRootOptions = {}): string {
  const { followSymlinks = true, label = 'path' } = options;

  if (candidate.includes('\0')) {
    throw new SentinelSecurityError(`Rejected ${label} containing a NUL byte.`, {
      remediation: 'Remove the invalid character from the reference and re-run the scan.',
    });
  }

  const absoluteRoot = followSymlinks ? realPathOrNearest(root) : path.resolve(root);
  const absoluteCandidate = path.isAbsolute(candidate) ? path.resolve(candidate) : path.resolve(absoluteRoot, candidate);

  if (!isPathInside(absoluteRoot, absoluteCandidate)) {
    throw new SentinelSecurityError(`Rejected ${label} that resolves outside the permitted root.`, {
      remediation: 'Sentinel Forge only reads inside the server directory it was pointed at.',
      details: { candidate: toPosixPath(candidate), root: toPosixPath(absoluteRoot) },
    });
  }

  if (!followSymlinks) return absoluteCandidate;

  const realCandidate = realPathOrNearest(absoluteCandidate);
  if (!isPathInside(absoluteRoot, realCandidate)) {
    throw new SentinelSecurityError(`Rejected ${label}: the target resolves outside the permitted root through a link.`, {
      remediation: 'Remove the link, or scan the directory the link points at directly.',
      details: { candidate: toPosixPath(candidate), root: toPosixPath(absoluteRoot) },
    });
  }

  return realCandidate;
}

/**
 * Renders an absolute path as a root-relative POSIX path for reports.
 * Absolute host paths are not written into reports: they leak the operator's
 * directory layout and make two reports of the same server incomparable.
 */
export function toRootRelative(root: string, absolute: string): string {
  const relative = path.relative(path.resolve(root), path.resolve(absolute));
  return toPosixPath(relative === '' ? '.' : relative);
}
