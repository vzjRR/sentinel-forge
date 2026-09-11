/**
 * Unexpected file types in a resource.
 *
 * A resource is Lua, JavaScript, configuration and assets. An executable, a
 * script for the host operating system, or an archive is worth a deliberate
 * look before the resource is trusted on a live server.
 *
 * Several legitimate resources do ship native modules, so the finding is an
 * observation with a confidence, not an accusation.
 */

export type SuspiciousFileKind = 'EXECUTABLE' | 'HOST_SCRIPT' | 'ARCHIVE' | 'NATIVE_MODULE' | 'DATABASE';

export interface SuspiciousFile {
  /** Resource-relative POSIX path. */
  readonly path: string;
  readonly kind: SuspiciousFileKind;
  readonly extension: string;
  readonly sizeBytes: number;
  readonly confidence: number;
  readonly reason: string;
}

const CLASSIFICATIONS: readonly { extensions: readonly string[]; kind: SuspiciousFileKind; confidence: number; reason: string }[] =
  Object.freeze([
    {
      extensions: ['.exe', '.msi', '.scr', '.com'],
      kind: 'EXECUTABLE',
      confidence: 0.9,
      reason: 'A Windows executable has no role in a FiveM resource.',
    },
    {
      extensions: ['.bat', '.cmd', '.ps1', '.sh', '.vbs'],
      kind: 'HOST_SCRIPT',
      confidence: 0.8,
      reason: 'A script for the host operating system runs outside the FiveM sandbox.',
    },
    {
      extensions: ['.zip', '.rar', '.7z', '.tar', '.gz'],
      kind: 'ARCHIVE',
      confidence: 0.4,
      reason: 'An archive inside a resource is often a leftover, and its contents are not analysed.',
    },
    {
      extensions: ['.dll', '.so', '.dylib', '.node', '.jar'],
      kind: 'NATIVE_MODULE',
      // Legitimate: several established resources ship native modules.
      confidence: 0.35,
      reason: 'A native module is opaque to analysis. Some resources ship one legitimately.',
    },
    {
      extensions: ['.db', '.sqlite', '.sqlite3', '.mdb'],
      kind: 'DATABASE',
      confidence: 0.3,
      reason: 'A database file inside a resource may contain data that should not be distributed.',
    },
  ]);

const BY_EXTENSION = new Map<string, (typeof CLASSIFICATIONS)[number]>(
  CLASSIFICATIONS.flatMap((classification) =>
    classification.extensions.map((extension) => [extension, classification] as const),
  ),
);

export interface FileEntry {
  readonly path: string;
  readonly size: number;
}

export function findSuspiciousFiles(files: readonly FileEntry[]): SuspiciousFile[] {
  const suspicious: SuspiciousFile[] = [];

  for (const file of files) {
    const dot = file.path.lastIndexOf('.');
    if (dot === -1) continue;
    const extension = file.path.slice(dot).toLowerCase();

    const classification = BY_EXTENSION.get(extension);
    if (classification === undefined) continue;

    suspicious.push({
      path: file.path,
      kind: classification.kind,
      extension,
      sizeBytes: file.size,
      confidence: classification.confidence,
      reason: classification.reason,
    });
  }

  return suspicious.sort((a, b) => b.confidence - a.confidence || a.path.localeCompare(b.path));
}
