/**
 * Server and resource discovery.
 *
 * Walks a server directory once and builds the inventory every later stage
 * works from: the configuration, the resources, and each resource's files with
 * their sizes and hashes.
 *
 * The whole tree is walked a single time. Re-walking per resource, or per
 * manifest declaration, is what turns a scan of a large server from seconds
 * into minutes.
 */

import path from 'node:path';
import {
  DEFAULT_MAX_FILE_BYTES,
  fingerprint,
  hashFile,
  readTextFileBounded,
  resolveWithinRoot,
  serverId as deriveServerId,
  toPosixPath,
  toRootRelative,
  walkDirectory,
  type Logger,
  type WalkedFile,
} from '@sentinel-forge/core';
import type { ServerFingerprint } from '@sentinel-forge/shared';
import { analyzeManifest, type ResourceManifest } from '../manifest/manifest.js';

export const MANIFEST_FILE_NAMES = ['fxmanifest.lua', '__resource.lua'] as const;

export interface DiscoveredFile {
  /** Resource-relative POSIX path. */
  readonly path: string;
  /** Server-relative POSIX path. */
  readonly serverPath: string;
  readonly size: number;
  readonly hash: string;
  readonly modifiedAt: string;
}

export interface DiscoveredResource {
  readonly name: string;
  /** Server-relative POSIX path of the resource directory. */
  readonly path: string;
  /** Absolute path on the host. Not written to reports. */
  readonly absolutePath: string;
  /** Category directory the resource sits in, e.g. `[managers]`. */
  readonly category?: string;
  readonly manifestKind: 'fxmanifest' | '__resource' | 'none';
  /** Resource-relative path of the manifest, when one exists. */
  readonly manifestPath?: string;
  readonly manifest?: ResourceManifest;
  /** True when the manifest exists but could not be read. */
  readonly manifestUnreadable?: boolean;
  readonly files: readonly DiscoveredFile[];
}

export interface DiscoveryLimitation {
  readonly path: string;
  readonly reason: string;
}

export interface DiscoveredServer {
  readonly id: string;
  readonly root: string;
  readonly fingerprint: ServerFingerprint;
  /** Server-relative path of the configuration file, when found. */
  readonly configPath?: string;
  readonly configSource?: string;
  readonly resources: readonly DiscoveredResource[];
  /** Files under the server root that belong to no resource. */
  readonly looseFileCount: number;
  readonly limitations: readonly DiscoveryLimitation[];
}

export interface DiscoverOptions {
  /** Directory names under the server root that contain resources. */
  readonly resourceDirectories: readonly string[];
  readonly maxDepth?: number;
  readonly maxFiles?: number;
  readonly maxFileBytes?: number;
  readonly followSymlinks?: boolean;
  readonly skipDirectories?: readonly string[];
  readonly logger?: Logger;
  readonly scannedAt: Date;
}

const CONFIG_FILE_CANDIDATES = ['server.cfg', 'server.config', 'run.cfg'] as const;

/** Groups walked files by the resource directory that owns them. */
interface ResourceGroup {
  readonly name: string;
  readonly relativeDirectory: string;
  readonly category: string | undefined;
  readonly files: WalkedFile[];
  manifestFile?: WalkedFile;
  manifestKind: 'fxmanifest' | '__resource' | 'none';
}

/**
 * Identifies the resource that owns a file, given the resource root prefixes.
 *
 * A resource directory is the first directory below a resource root, except
 * that a `[category]` directory contains resources rather than being one.
 */
function locateResource(
  relativePath: string,
  resourceRoots: readonly string[],
): { name: string; directory: string; category: string | undefined } | null {
  for (const root of resourceRoots) {
    const prefix = `${root}/`;
    if (!relativePath.startsWith(prefix)) continue;

    const remainder = relativePath.slice(prefix.length);
    const segments = remainder.split('/');
    const first = segments[0];
    if (first === undefined || segments.length < 2) return null;

    if (first.startsWith('[') && first.endsWith(']')) {
      const second = segments[1];
      if (second === undefined || segments.length < 3) return null;
      return { name: second, directory: `${root}/${first}/${second}`, category: first };
    }

    return { name: first, directory: `${root}/${first}`, category: undefined };
  }
  return null;
}

export async function discoverServer(serverRoot: string, options: DiscoverOptions): Promise<DiscoveredServer> {
  const absoluteRoot = resolveWithinRoot(serverRoot, '.', { label: 'server path' });
  const limitations: DiscoveryLimitation[] = [];

  const walk = await walkDirectory(absoluteRoot, {
    ...(options.maxDepth === undefined ? {} : { maxDepth: options.maxDepth }),
    ...(options.maxFiles === undefined ? {} : { maxEntries: options.maxFiles }),
    ...(options.skipDirectories === undefined ? {} : { skipDirectories: options.skipDirectories }),
    ...(options.followSymlinks === undefined ? {} : { followSymlinks: options.followSymlinks }),
  });

  for (const skipped of walk.skipped) {
    limitations.push({ path: skipped.path, reason: skipped.reason });
  }
  if (walk.stopReason === 'MAX_ENTRIES_REACHED') {
    limitations.push({
      path: '.',
      reason: 'Traversal stopped at the configured file limit; the inventory is incomplete.',
    });
  }

  const resourceRoots = options.resourceDirectories.map((entry) => toPosixPath(entry).replace(/\/+$/, ''));
  const groups = new Map<string, ResourceGroup>();
  let looseFileCount = 0;

  for (const file of walk.files) {
    const located = locateResource(file.relativePath, resourceRoots);
    if (located === null) {
      looseFileCount += 1;
      continue;
    }

    let group = groups.get(located.directory);
    if (group === undefined) {
      group = {
        name: located.name,
        relativeDirectory: located.directory,
        category: located.category,
        files: [],
        manifestKind: 'none',
      };
      groups.set(located.directory, group);
    }

    group.files.push(file);

    const resourceRelative = file.relativePath.slice(located.directory.length + 1);
    if (resourceRelative === 'fxmanifest.lua') {
      group.manifestFile = file;
      group.manifestKind = 'fxmanifest';
    } else if (resourceRelative === '__resource.lua' && group.manifestKind === 'none') {
      // fxmanifest.lua wins when both are present: the server prefers it.
      group.manifestFile = file;
      group.manifestKind = '__resource';
    }
  }

  const resources: DiscoveredResource[] = [];

  for (const group of [...groups.values()].sort((a, b) => a.name.localeCompare(b.name))) {
    const files: DiscoveredFile[] = [];
    for (const file of group.files) {
      files.push({
        path: file.relativePath.slice(group.relativeDirectory.length + 1),
        serverPath: file.relativePath,
        size: file.size,
        hash: await hashFile(file.absolutePath),
        modifiedAt: file.modifiedAt.toISOString(),
      });
    }
    files.sort((a, b) => a.path.localeCompare(b.path));

    let manifest: ResourceManifest | undefined;
    let manifestUnreadable = false;

    if (group.manifestFile !== undefined) {
      try {
        const read = await readTextFileBounded(group.manifestFile.absolutePath, {
          root: absoluteRoot,
          maxBytes: options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES,
        });
        manifest = analyzeManifest(read.content);
      } catch (error) {
        manifestUnreadable = true;
        limitations.push({
          path: group.manifestFile.relativePath,
          reason: `Manifest could not be read: ${error instanceof Error ? error.message : 'unknown error'}`,
        });
      }
    }

    resources.push({
      name: group.name,
      path: group.relativeDirectory,
      absolutePath: path.join(absoluteRoot, ...group.relativeDirectory.split('/')),
      ...(group.category === undefined ? {} : { category: group.category }),
      manifestKind: group.manifestKind,
      ...(group.manifestFile === undefined
        ? {}
        : { manifestPath: group.manifestFile.relativePath.slice(group.relativeDirectory.length + 1) }),
      ...(manifest === undefined ? {} : { manifest }),
      ...(manifestUnreadable ? { manifestUnreadable } : {}),
      files,
    });
  }

  const configLocation = findServerConfig(absoluteRoot, walk.files);
  let configSource: string | undefined;
  if (configLocation !== undefined) {
    try {
      const read = await readTextFileBounded(configLocation.absolutePath, {
        root: absoluteRoot,
        maxBytes: options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES,
      });
      configSource = read.content;
    } catch (error) {
      limitations.push({
        path: configLocation.relativePath,
        reason: `Server configuration could not be read: ${error instanceof Error ? error.message : 'unknown error'}`,
      });
    }
  }

  const id = deriveServerId(absoluteRoot);
  const serverFingerprint: ServerFingerprint = {
    id,
    path: absoluteRoot,
    ...(configLocation === undefined ? {} : { configPath: configLocation.relativePath }),
    resourceRoots,
    resourceCount: resources.length,
    fingerprint: fingerprint([
      ...resources.map((resource) => `${resource.name}:${resource.files.length}`),
      ...(configSource === undefined ? [] : [`config:${configSource.length}`]),
    ]),
    scannedAt: options.scannedAt.toISOString(),
  };

  options.logger?.debug('Discovery complete.', {
    resources: resources.length,
    files: walk.files.length,
    limitations: limitations.length,
  });

  return {
    id,
    root: absoluteRoot,
    fingerprint: serverFingerprint,
    ...(configLocation === undefined ? {} : { configPath: configLocation.relativePath }),
    ...(configSource === undefined ? {} : { configSource }),
    resources,
    looseFileCount,
    limitations,
  };
}

function findServerConfig(
  absoluteRoot: string,
  files: readonly WalkedFile[],
): { absolutePath: string; relativePath: string } | undefined {
  for (const candidate of CONFIG_FILE_CANDIDATES) {
    const match = files.find((file) => file.relativePath === candidate);
    if (match !== undefined) {
      return { absolutePath: match.absolutePath, relativePath: match.relativePath };
    }
  }
  // Fall back to a configuration file one level down, which is a common layout
  // when the server data directory sits beside the artifact.
  const nested = files.find((file) => {
    const segments = file.relativePath.split('/');
    return segments.length === 2 && CONFIG_FILE_CANDIDATES.includes(segments[1] as (typeof CONFIG_FILE_CANDIDATES)[number]);
  });
  return nested === undefined
    ? undefined
    : { absolutePath: nested.absolutePath, relativePath: toRootRelative(absoluteRoot, nested.absolutePath) };
}
