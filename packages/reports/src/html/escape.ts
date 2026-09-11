/**
 * HTML escaping.
 *
 * Every value rendered into a Sentinel Forge page comes from somewhere
 * untrusted: a resource name, a file path, a manifest string, an excerpt of
 * third-party Lua. Escaping is therefore not a convenience here — it is the
 * boundary that stops a scanned server from executing script in the operator's
 * browser.
 *
 * The rule this module exists to enforce: **no interpolation into HTML happens
 * anywhere else.** A renderer that builds a tag by concatenation without going
 * through `escapeHtml` or `escapeAttribute` is a defect, and
 * `packages/reports/src/html/escape.test.ts` asserts the property that matters
 * rather than the spelling.
 *
 * © 2026 Talal Al Ghafri. All Rights Reserved.
 */

const HTML_ENTITIES: Readonly<Record<string, string>> = Object.freeze({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '`': '&#96;',
});

/**
 * Escapes text for placement in element content or in a quoted attribute.
 *
 * Backtick is escaped as well as the usual five: in some legacy engines a
 * backtick can delimit an attribute value, and the cost of covering it is one
 * character in a lookup table.
 */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"'`]/g, (character) => HTML_ENTITIES[character] ?? character);
}

/** Escapes a value for a quoted attribute. Identical rules; named for intent. */
export function escapeAttribute(value: string): string {
  return escapeHtml(value);
}

/**
 * Turns arbitrary text into a token safe for an `id` or a CSS class.
 *
 * Anything outside `[A-Za-z0-9_-]` is replaced, so a resource named
 * `sf_shop" onmouseover="…` cannot become markup even if an attribute were
 * built without escaping.
 */
export function slug(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned.length === 0 ? 'x' : cleaned.toLowerCase();
}

/**
 * Escapes text for embedding inside a `<script>` block as JSON.
 *
 * `</script>` inside a JSON string would end the block; `<!--` can start a
 * comment in an HTML-parsed script. Both are escaped as unicode sequences,
 * which JSON.parse reads identically.
 */
export function escapeJsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
