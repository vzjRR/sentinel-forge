/**
 * Bounded file reading.
 *
 * A scanner that reads whatever it is pointed at is a denial-of-service vector
 * against its own host: a 6 GB log or a FIFO will exhaust memory or block
 * indefinitely. Reads are therefore bounded by size and restricted to regular
 * files.
 */

import { open, stat } from 'node:fs/promises';
import { SentinelSecurityError, SentinelUserError } from '../errors.js';
import { resolveWithinRoot, toRootRelative } from './paths.js';

/** Default cap for a single analyzed source file (4 MiB). */
export const DEFAULT_MAX_FILE_BYTES = 4 * 1024 * 1024;

export interface ReadFileOptions {
  /** Containment root. The resolved path must stay inside it. */
  readonly root: string;
  readonly maxBytes?: number;
  /**
   * When `true`, a file larger than `maxBytes` is truncated to the cap instead
   * of raising. Truncation is reported through {@link BoundedReadResult}.
   */
  readonly truncate?: boolean;
}

export interface BoundedReadResult {
  readonly content: string;
  readonly bytesRead: number;
  readonly totalBytes: number;
  readonly truncated: boolean;
  /** Root-relative POSIX path, safe to place in a report. */
  readonly relativePath: string;
}

/**
 * Reads a UTF-8 text file with containment and size enforcement.
 *
 * @throws {SentinelSecurityError} when the path escapes `root` or is not a regular file.
 * @throws {SentinelUserError} when the file exceeds `maxBytes` and `truncate` is not set.
 */
export async function readTextFileBounded(
  filePath: string,
  options: ReadFileOptions,
): Promise<BoundedReadResult> {
  const { root, maxBytes = DEFAULT_MAX_FILE_BYTES, truncate = false } = options;
  const resolved = resolveWithinRoot(root, filePath, { label: 'file path' });
  const stats = await stat(resolved);

  if (!stats.isFile()) {
    throw new SentinelSecurityError('Refused to read a path that is not a regular file.', {
      remediation: 'Sentinel Forge reads regular files only; devices, sockets and FIFOs are skipped.',
      details: { path: toRootRelative(root, resolved) },
    });
  }

  const totalBytes = stats.size;
  if (totalBytes > maxBytes && !truncate) {
    throw new SentinelUserError(
      `File exceeds the configured read limit (${totalBytes} bytes > ${maxBytes} bytes).`,
      {
        remediation: 'Raise `limits.maxFileBytes` in sentinel.config.json, or exclude the file from analysis.',
        details: { path: toRootRelative(root, resolved), totalBytes, maxBytes },
      },
    );
  }

  const bytesToRead = Math.min(totalBytes, maxBytes);
  const handle = await open(resolved, 'r');
  try {
    const buffer = Buffer.allocUnsafe(bytesToRead);
    const { bytesRead } = await handle.read(buffer, 0, bytesToRead, 0);
    return {
      content: buffer.subarray(0, bytesRead).toString('utf8'),
      bytesRead,
      totalBytes,
      truncated: totalBytes > bytesToRead,
      relativePath: toRootRelative(root, resolved),
    };
  } finally {
    await handle.close();
  }
}

/** True when a buffer prefix suggests binary content (NUL byte in the first 8 KiB). */
export function looksBinary(sample: Buffer): boolean {
  const limit = Math.min(sample.length, 8192);
  for (let index = 0; index < limit; index += 1) {
    if (sample[index] === 0) return true;
  }
  return false;
}
