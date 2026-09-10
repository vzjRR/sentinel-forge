/**
 * Glob matching for manifest file patterns.
 *
 * FiveM manifests accept globs in script and file lists. The documented forms
 * are `*.lua` (non-recursive), `**` and `**\/*.lua` (recursive), and prefix
 * matching such as `**\/cl_*.lua`.
 *
 * Matching is implemented by translating the pattern to a regular expression
 * rather than by walking the filesystem, because the scanner already holds the
 * resource's complete file inventory and re-reading directories per pattern
 * would multiply the cost of a scan by the number of declarations.
 *
 * Reference: https://docs.fivem.net/docs/scripting-reference/resource-manifest/
 */

/** Characters that must be escaped when a pattern segment becomes a regex. */
const REGEX_SPECIAL = /[.+^${}()|[\]\\]/g;

export function isGlob(pattern: string): boolean {
  return pattern.includes('*') || pattern.includes('?');
}

/**
 * Compiles a glob into an anchored regular expression over POSIX paths.
 *
 * Semantics:
 *   `*`  matches any run of characters except `/`
 *   `?`  matches a single character except `/`
 *   `**` matches across directory separators
 *   a trailing `**` also matches the empty remainder, so `html/**` matches
 *   `html/index.html` and every file beneath it
 */
export function globToRegExp(pattern: string): RegExp {
  const normalized = pattern.replace(/\\/g, '/');
  let expression = '';

  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index] ?? '';

    if (character === '*') {
      const isDouble = normalized[index + 1] === '*';
      if (isDouble) {
        index += 1;
        if (normalized[index + 1] === '/') {
          // `**/` matches zero or more leading directories.
          index += 1;
          expression += '(?:[^/]*/)*';
        } else {
          expression += '.*';
        }
        continue;
      }
      expression += '[^/]*';
      continue;
    }

    if (character === '?') {
      expression += '[^/]';
      continue;
    }

    expression += character.replace(REGEX_SPECIAL, '\\$&');
  }

  return new RegExp(`^${expression}$`);
}

/**
 * Returns the resource-relative paths matching `pattern`.
 * A pattern without wildcards matches only its exact path.
 */
export function matchGlob(pattern: string, paths: readonly string[]): string[] {
  const normalized = pattern.replace(/\\/g, '/');
  if (!isGlob(normalized)) {
    return paths.filter((candidate) => candidate === normalized);
  }
  const expression = globToRegExp(normalized);
  return paths.filter((candidate) => expression.test(candidate));
}
