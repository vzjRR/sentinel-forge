/**
 * Secret redaction.
 *
 * Sentinel Forge detects credentials in scanned code. It must never become a
 * mechanism for *spreading* them: raw secret values are not written to logs,
 * to the local database, or to any report.
 *
 * Redaction is applied at three boundaries:
 *   1. log records (see `logger.ts`),
 *   2. error messages (see `errors.ts`),
 *   3. evidence excerpts, before persistence or rendering.
 *
 * The patterns below are deliberately shaped around *known credential formats*
 * rather than general entropy. Entropy-only redaction removes legitimate
 * diagnostic content (hashes, resource names, asset ids) and would degrade the
 * evidence a report depends on. Detection of unknown-format secrets is the
 * responsibility of the secret scanner (SEC-SECRET-001, GATE 4), which reports
 * a *location* rather than a value.
 */

export const REDACTION_MASK = '********';

interface RedactionPattern {
  readonly name: string;
  readonly pattern: RegExp;
  readonly replace: (match: string, ...groups: string[]) => string;
}

/**
 * Keys whose assigned value is treated as sensitive regardless of its shape.
 * Matched case-insensitively against `key = value`, `key: value` and
 * `"key": "value"` forms.
 */
/**
 * Credential keys are frequently namespaced by the platform or the resource
 * (`sv_licenseKey`, `mysql_password`, `discord_bot_token`). The prefix is
 * absorbed so the key itself still matches.
 */
const KEY_PREFIX = '(?:[A-Za-z0-9]{1,32}[_.-]?)?';

const SENSITIVE_KEY_PATTERN =
  '(?:password|passwd|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|auth[_-]?token|authorization|credential|licen[cs]e[_-]?key|webhook[_-]?url|connection[_-]?string|db[_-]?pass)';

const PATTERNS: readonly RedactionPattern[] = Object.freeze([
  {
    // Discord webhook endpoints — keep the origin so the finding stays readable.
    name: 'discord-webhook',
    pattern: /https?:\/\/(?:[a-z0-9-]+\.)?discord(?:app)?\.com\/api\/(?:v\d+\/)?webhooks\/[\w-]+\/[\w-]+/gi,
    replace: (match) => `${match.slice(0, match.indexOf('/webhooks/') + '/webhooks/'.length)}${REDACTION_MASK}`,
  },
  {
    // Any other webhook-shaped URL with a long opaque path segment.
    name: 'generic-webhook',
    pattern: /https?:\/\/[^\s"'`]*\/webhooks?\/[A-Za-z0-9_\-/]{16,}/gi,
    replace: (match) => `${match.slice(0, match.toLowerCase().lastIndexOf('/webhook'))}/webhook/${REDACTION_MASK}`,
  },
  {
    // PEM-encoded private key blocks.
    name: 'private-key-block',
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g,
    replace: () => `-----BEGIN PRIVATE KEY-----${REDACTION_MASK}-----END PRIVATE KEY-----`,
  },
  {
    // Credentials embedded in a URI authority: scheme://user:password@host
    name: 'uri-credentials',
    pattern: /([a-z][a-z0-9+.-]*:\/\/[^\s:/@"']+):([^\s@"'/]+)@/gi,
    replace: (_match, prefix) => `${prefix}:${REDACTION_MASK}@`,
  },
  {
    // Authorization headers, including Bearer and Basic schemes.
    name: 'authorization-header',
    pattern: /(authorization\s*[:=]\s*["']?\s*(?:bearer|basic|token)\s+)([\w.~+/=-]{8,})/gi,
    replace: (_match, prefix) => `${prefix}${REDACTION_MASK}`,
  },
  {
    // JSON Web Tokens.
    name: 'jwt',
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    replace: () => REDACTION_MASK,
  },
  {
    // Discord bot tokens (id.timestamp.hmac).
    name: 'discord-bot-token',
    pattern: /\b[A-Za-z0-9_-]{23,28}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,40}\b/g,
    replace: () => REDACTION_MASK,
  },
  {
    // `key = "value"` / `key: value` where the key names a credential.
    name: 'sensitive-assignment',
    pattern: new RegExp(
      `(["'\`]?${KEY_PREFIX}${SENSITIVE_KEY_PATTERN}["'\`]?\\s*(?:=|:|=>)\\s*)(["'\`])([^"'\`\\n]{1,512})(\\2)`,
      'gi',
    ),
    replace: (_match, prefix, quote) => `${prefix}${quote}${REDACTION_MASK}${quote}`,
  },
  {
    // Unquoted variant, e.g. `set mysql_connection_string user=root password=hunter2`.
    name: 'sensitive-assignment-unquoted',
    // `(?![=>])` keeps comparisons (`token === value`) and arrows out of the
    // match; only assignment-shaped text is treated as a credential.
    pattern: new RegExp(`(\\b${KEY_PREFIX}${SENSITIVE_KEY_PATTERN}\\s*(?:=|:)(?![=>])\\s*)([^\\s"'\`;,)]{1,512})`, 'gi'),
    replace: (_match, prefix) => `${prefix}${REDACTION_MASK}`,
  },
]);

/**
 * Replaces credential-shaped substrings with {@link REDACTION_MASK}.
 *
 * The function is total: it never throws, and it returns the input unchanged
 * when nothing matched. It is safe to call repeatedly — redacted output does
 * not itself match any pattern in a way that loses further information.
 */
export function redactText(text: string): string {
  if (text.length === 0) return text;
  let output = text;
  for (const { pattern, replace } of PATTERNS) {
    // Patterns are module-level and carry /g, so reset lastIndex before use.
    pattern.lastIndex = 0;
    output = output.replace(pattern, replace as (substring: string, ...args: unknown[]) => string);
  }
  return output;
}

/** Reports whether redaction would alter the input. Used by redaction tests. */
export function containsRedactableSecret(text: string): boolean {
  return redactText(text) !== text;
}

/**
 * Masks a value that is already known to be a secret, preserving a short
 * recognizable prefix so an operator can tell two findings apart without the
 * value being recoverable.
 *
 * @param value - The raw secret. Never persisted by the caller.
 * @param visiblePrefix - Characters to keep (default 4, capped at a quarter of
 *   the value length so short secrets are fully masked).
 */
export function maskSecret(value: string, visiblePrefix = 4): string {
  const allowed = Math.max(0, Math.min(visiblePrefix, Math.floor(value.length / 4)));
  return `${value.slice(0, allowed)}${REDACTION_MASK}`;
}

/**
 * Deep-redacts a structure destined for a log record or a JSON report.
 * Strings are redacted, keys with sensitive names are masked wholesale, and
 * cycles are replaced with `"[Circular]"` rather than throwing.
 */
export function redactValue<T>(value: T): T {
  return redactUnknown(value, new WeakSet()) as T;
}

const SENSITIVE_KEY_RE = new RegExp(`^${KEY_PREFIX}${SENSITIVE_KEY_PATTERN}$`, 'i');

function redactUnknown(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return redactText(value);
  if (value === null || typeof value !== 'object') return value;

  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((entry) => redactUnknown(entry, seen));
  }

  if (value instanceof Date) return value;

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    output[key] = SENSITIVE_KEY_RE.test(key) && typeof entry === 'string' ? REDACTION_MASK : redactUnknown(entry, seen);
  }
  return output;
}
