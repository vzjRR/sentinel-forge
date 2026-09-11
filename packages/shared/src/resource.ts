/**
 * Server and resource description contracts.
 *
 * These describe what was *discovered on disk*. Runtime state is a separate
 * concern — measured by the `sentinel_doctor` collector — and is never
 * inferred from a static scan.
 */

export interface ServerFingerprint {
  /** Stable identifier derived from the canonical server path. */
  readonly id: string;
  /** Absolute path of the scanned server root, as supplied by the operator. */
  readonly path: string;
  /** Path to the server configuration file, when discovered. */
  readonly configPath?: string;
  /** Discovered resource root directories, server-relative. */
  readonly resourceRoots: readonly string[];
  readonly resourceCount: number;
  /** Hash over the discovered configuration and resource inventory. */
  readonly fingerprint: string;
  readonly scannedAt: string;
}

export type ManifestKind = 'fxmanifest' | '__resource' | 'none';

export interface ResourceFileRef {
  /** Resource-relative POSIX path. */
  readonly path: string;
  readonly size: number;
  /** SHA-256, lowercase hex. */
  readonly hash: string;
  /** ISO-8601 modification time reported by the filesystem. */
  readonly modifiedAt: string;
}

export interface ResourceDescriptor {
  readonly name: string;
  /** Server-relative POSIX path of the resource directory. */
  readonly path: string;
  readonly manifestKind: ManifestKind;
  /** Version string when declared in the manifest; absent otherwise. Never guessed. */
  readonly version?: string;
  readonly declaredDependencies: readonly string[];
  readonly fileCount: number;
}

export type DependencyEdgeKind = 'DECLARED' | 'DISCOVERED' | 'OPTIONAL';

export interface DependencyEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: DependencyEdgeKind;
  readonly resolved: boolean;
  /** Where the dependency was declared, for evidence. */
  readonly declaredIn?: string;
}
