/**
 * Content hashing for integrity tracking and fingerprinting.
 *
 * SHA-256 is used throughout. Hashes are lowercase hex and are compared
 * literally, so the algorithm is recorded alongside stored hashes to keep a
 * future migration possible without ambiguity.
 */

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';

export const HASH_ALGORITHM = 'sha256';

/** Hashes a string. Used for fingerprints derived from already-loaded content. */
export function hashString(value: string): string {
  return createHash(HASH_ALGORITHM).update(value, 'utf8').digest('hex');
}

/**
 * Hashes a file by streaming it, so file size does not drive memory use.
 * The caller is responsible for containment (see `resolveWithinRoot`).
 */
export async function hashFile(absolutePath: string): Promise<string> {
  const hash = createHash(HASH_ALGORITHM);
  await pipeline(createReadStream(absolutePath), hash);
  return hash.digest('hex');
}

/**
 * Produces a stable fingerprint from an unordered set of parts.
 * Parts are sorted before hashing so the result does not depend on directory
 * iteration order, which differs between filesystems.
 */
export function fingerprint(parts: readonly string[]): string {
  const hash = createHash(HASH_ALGORITHM);
  for (const part of [...parts].sort()) {
    hash.update(part, 'utf8');
    hash.update(' ');
  }
  return hash.digest('hex');
}

/** Short display form of a hash for tables and CLI output. */
export function shortHash(hash: string, length = 12): string {
  return hash.slice(0, length);
}
