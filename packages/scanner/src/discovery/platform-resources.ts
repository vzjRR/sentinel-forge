/**
 * Resources provided by the platform rather than by the operator.
 *
 * A dependency on one of these is not a missing dependency: the resource ships
 * with the server data set or the artifact itself, and will not be found in the
 * operator's own resources directory. Reporting them would produce a false
 * positive on nearly every real server, which is why they are handled
 * explicitly rather than by a heuristic.
 *
 * The list below is limited to names verified in the official cfx-server-data
 * repository (https://github.com/citizenfx/cfx-server-data), under the category
 * directories `[system]`, `[managers]`, `[gameplay]` and `[gamemodes]`.
 *
 * A name absent from this list is *not* assumed to be missing on that basis
 * alone; it simply gets no exemption. Where a resource may be bundled but is
 * unverified, the correct handling is a lower confidence value, not silence.
 */
export const BUNDLED_SERVER_DATA_RESOURCES: ReadonlySet<string> = new Set([
  // [system]
  'baseevents',
  'runcode',
  // [managers]
  'mapmanager',
  'spawnmanager',
  // [gameplay]
  'player-data',
  'playernames',
  'chat-theme-example',
  // [gamemodes]
  'basic-gamemode',
  // repository root
  'example-loadscreen',
]);

/**
 * Category directory names used by the official server data layout. A category
 * groups resources and is a valid target for `ensure`/`start`/`stop`/`restart`.
 */
export const KNOWN_CATEGORY_DIRECTORIES: ReadonlySet<string> = new Set([
  '[gamemodes]',
  '[gameplay]',
  '[local]',
  '[managers]',
  '[system]',
  '[test]',
]);

export function isBundledResource(name: string): boolean {
  return BUNDLED_SERVER_DATA_RESOURCES.has(name.toLowerCase());
}
