/**
 * Redaction for values shown in the dashboard.
 *
 * The server configuration is the one place the dashboard displays raw values
 * taken from the scanned server, and it is also the file most likely to contain
 * a credential: `sv_licenseKey`, a database connection string, a Discord token,
 * a webhook. A page that prints one has leaked it to anything that can read the
 * screen, the page source, or a saved copy.
 *
 * Two independent checks, because each catches what the other misses:
 *
 *   1. **By key name.** `sv_licenseKey`, `*_token`, `*_password` and the rest
 *      are redacted whatever their value looks like. This catches a short or
 *      unusual credential that no detector would recognise.
 *   2. **By value shape.** The product's own credential detector is run over
 *      the assignment. This catches a credential under a key name nobody
 *      thought of — `set my_thing "cfx_k1_…"`.
 *
 * A value only reaches the page if both checks pass. Getting this wrong in the
 * safe direction hides a port number; getting it wrong in the other direction
 * publishes a license key.
 *
 * © 2026 Talal Al Ghafri. All Rights Reserved.
 */

import { maskSecret, redactValue } from '@sentinel-forge/core';
import { scanSecrets } from '@sentinel-forge/security';
import type { ParsedServerConfig } from '@sentinel-forge/scanner';

/** Shown in place of a value that was withheld. */
export const REDACTED_DISPLAY = '(redacted)';

/**
 * Returns the value to display for a configuration variable.
 *
 * @param name - The variable's name, as written in the configuration.
 * @param value - The value as parsed. Never returned unchanged when either
 *   check identifies it as sensitive.
 */
export function displayConfigValue(name: string, value: string): string {
  if (value.length === 0) return value;

  // Check 1: the key name. `redactValue` applies the product's sensitive-key
  // rules, which are the same ones that protect log records and reports.
  const keyed = redactValue({ [name]: value })[name];
  if (keyed !== value) return REDACTED_DISPLAY;

  // Check 2: the value's shape, judged by the product's own detector on the
  // assignment as it would appear in a file.
  if (scanSecrets(`${name} = "${value}"`, { filePath: 'server.cfg', maxMatches: 1 }).length > 0) {
    return REDACTED_DISPLAY;
  }

  // A long opaque token under an unremarkable key name is still not something
  // to print in full. Showing its first characters is enough for an operator to
  // recognise which value they are looking at.
  if (value.length > 64 && !value.includes(' ')) return maskSecret(value, 6);

  return value;
}

/**
 * Redacts a parsed configuration for transport.
 *
 * The JSON API returns the same data the pages show, and it must be held to the
 * same rule. Returning the parsed configuration verbatim would make `/api/…`
 * the leak that the page was carefully written not to be — and a JSON endpoint
 * is the easier of the two to scrape.
 */
export function redactParsedConfig(config: ParsedServerConfig): ParsedServerConfig {
  return {
    ...config,
    variables: config.variables.map((variable) => ({
      ...variable,
      value: displayConfigValue(variable.name, variable.value),
    })),
  };
}
