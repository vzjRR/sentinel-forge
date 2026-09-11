/**
 * Secret detection.
 *
 * The governing constraint: **Sentinel Forge finds credentials without ever
 * reproducing one.** A detector returns a location, a type and a redacted
 * excerpt. The raw value is never placed in a finding, a report, a log line, or
 * the database — a tool that reads other people's servers must not become a way
 * to copy their secrets out of them.
 *
 * Detection is by *known credential format* first, with entropy used only as a
 * secondary signal on values assigned to credential-named keys. Entropy alone
 * matches hashes, asset identifiers and UUIDs, which are exactly the diagnostic
 * content a report exists to carry.
 *
 * © 2026 Talal Al Ghafri. All Rights Reserved.
 */

import { maskSecret, redactText } from '@sentinel-forge/core';

export type SecretKind =
  | 'DISCORD_WEBHOOK'
  | 'GENERIC_WEBHOOK'
  | 'PRIVATE_KEY'
  | 'JWT'
  | 'DISCORD_BOT_TOKEN'
  | 'URI_CREDENTIALS'
  | 'AUTHORIZATION_HEADER'
  | 'API_KEY'
  | 'PASSWORD'
  | 'LICENSE_KEY'
  | 'HIGH_ENTROPY_ASSIGNMENT';

export interface SecretMatch {
  readonly kind: SecretKind;
  /** 1-based line of the match. */
  readonly line: number;
  /** 1-based column of the match. */
  readonly column: number;
  /** 1-based column just past the match, used to drop overlapping matches. */
  readonly endColumn: number;
  /** The surrounding line, redacted. Safe to store and display. */
  readonly redactedExcerpt: string;
  /**
   * A masked form of the matched value: a short prefix plus a mask, so two
   * different secrets on one line can be told apart without either being
   * recoverable.
   */
  readonly maskedValue: string;
  /** 0–1 that this is a live credential rather than a placeholder. */
  readonly confidence: number;
  /** Why the confidence is what it is. */
  readonly reasons: readonly string[];
}

interface SecretPattern {
  readonly kind: SecretKind;
  readonly pattern: RegExp;
  /** Base confidence before placeholder and context adjustments. */
  readonly baseConfidence: number;
  readonly description: string;
}

/**
 * Values that are self-evidently not live credentials. A resource shipping an
 * example configuration is the single most common source of false positives
 * here, so the check is explicit rather than left to entropy.
 */
const PLACEHOLDER_MARKERS =
  /example|placeholder|your[_-]?|xxx+|changeme|dummy|sample|todo|insert[_-]?|<[^>]+>|\bfake\b|test[_-]?key|fixture/i;

/** Repeated or sequential characters, e.g. `000000000000` or `abcabcabc`. */
function looksSynthetic(value: string): boolean {
  if (/^(.)\1{5,}$/.test(value)) return true;
  if (/^(0+|1+|x+|X+)$/.test(value)) return true;
  return /^(abc|123|aaa|000)/i.test(value) && value.length < 24;
}

const PATTERNS: readonly SecretPattern[] = Object.freeze([
  {
    kind: 'DISCORD_WEBHOOK',
    pattern: /https?:\/\/(?:[a-z0-9-]+\.)?discord(?:app)?\.com\/api\/(?:v\d+\/)?webhooks\/(\d+)\/([\w-]{20,})/gi,
    baseConfidence: 0.95,
    description: 'Discord webhook endpoint',
  },
  {
    kind: 'GENERIC_WEBHOOK',
    pattern: /https?:\/\/[^\s"'`]+\/webhooks?\/([A-Za-z0-9_\-/]{16,})/gi,
    baseConfidence: 0.7,
    description: 'Webhook endpoint',
  },
  {
    kind: 'PRIVATE_KEY',
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g,
    baseConfidence: 0.95,
    description: 'PEM private key block',
  },
  {
    kind: 'JWT',
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    baseConfidence: 0.85,
    description: 'JSON Web Token',
  },
  {
    kind: 'DISCORD_BOT_TOKEN',
    pattern: /\b[A-Za-z0-9_-]{23,28}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,40}\b/g,
    baseConfidence: 0.8,
    description: 'Discord bot token',
  },
  {
    kind: 'URI_CREDENTIALS',
    pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@"']+:([^\s@"'/]{4,})@/gi,
    baseConfidence: 0.9,
    description: 'Credentials embedded in a connection URI',
  },
  {
    kind: 'AUTHORIZATION_HEADER',
    pattern: /authorization\s*[:=]\s*["']?\s*(?:bearer|basic|token)\s+([\w.~+/=-]{12,})/gi,
    baseConfidence: 0.85,
    description: 'Authorization header value',
  },
  {
    kind: 'API_KEY',
    pattern:
      /\b[\w.-]{0,24}(?:api[_-]?key|apikey|access[_-]?key|secret[_-]?key|client[_-]?secret)\b\s*(?:=|:|=>)\s*["'`]([^"'`\n]{8,})["'`]/gi,
    baseConfidence: 0.8,
    description: 'API key assignment',
  },
  {
    kind: 'PASSWORD',
    pattern: /\b[\w.-]{0,24}(?:password|passwd|pwd|db[_-]?pass)\b\s*(?:=|:|=>)\s*["'`]([^"'`\n]{4,})["'`]/gi,
    baseConfidence: 0.75,
    description: 'Password assignment',
  },
  {
    kind: 'LICENSE_KEY',
    pattern: /\b[\w.-]{0,24}licen[cs]e[_-]?key\b\s*(?:=|:|\s)\s*["'`]?([\w-]{12,})["'`]?/gi,
    baseConfidence: 0.75,
    description: 'License key',
  },
]);

/**
 * How specifically a pattern identifies what it matched.
 *
 * Patterns overlap: a Discord webhook is also a generic webhook. When two
 * match the same span, the more specific classification is the correct one to
 * keep — it carries the right label, and it analysed the right part of the
 * match when judging whether the value is live.
 */
const SPECIFICITY: Readonly<Record<SecretKind, number>> = Object.freeze({
  PRIVATE_KEY: 5,
  DISCORD_WEBHOOK: 5,
  JWT: 4,
  URI_CREDENTIALS: 4,
  DISCORD_BOT_TOKEN: 3,
  AUTHORIZATION_HEADER: 3,
  API_KEY: 2,
  LICENSE_KEY: 2,
  PASSWORD: 2,
  GENERIC_WEBHOOK: 1,
  HIGH_ENTROPY_ASSIGNMENT: 0,
});

/**
 * Shannon entropy in bits per character. Used only as a secondary signal:
 * a credential-named assignment whose value is long and high-entropy is more
 * likely live than one that is short and word-like.
 */
export function shannonEntropy(value: string): number {
  if (value.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const character of value) counts.set(character, (counts.get(character) ?? 0) + 1);

  let entropy = 0;
  for (const count of counts.values()) {
    const probability = count / value.length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy;
}

export interface ScanSecretsOptions {
  /** Path reported with each match, for evidence. */
  readonly filePath: string;
  /** Maximum matches to return from one file, to bound a hostile input. */
  readonly maxMatches?: number;
}

/**
 * Finds credential-shaped values in a file's text.
 *
 * @returns Matches with redacted excerpts. The raw value never leaves this
 *   function: it is used to compute confidence and a mask, and then dropped.
 */
export function scanSecrets(content: string, options: ScanSecretsOptions): SecretMatch[] {
  const maxMatches = options.maxMatches ?? 200;
  const lines = content.split(/\r?\n/);
  const matches: SecretMatch[] = [];

  for (const [index, line] of lines.entries()) {
    if (matches.length >= maxMatches) break;
    // A single enormous line is either minified or generated; scanning it with
    // every pattern is expensive and the result is not actionable anyway.
    if (line.length > 4000) continue;

    for (const { kind, pattern, baseConfidence } of PATTERNS) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = pattern.exec(line)) !== null) {
        if (matches.length >= maxMatches) break;

        // The captured group is the secret itself where the pattern defines
        // one; otherwise the whole match is treated as the value.
        const value = match[match.length - 1] ?? match[0];
        const reasons: string[] = [];
        let confidence = baseConfidence;

        if (PLACEHOLDER_MARKERS.test(match[0])) {
          confidence -= 0.5;
          reasons.push('The value is marked as an example or placeholder.');
        }
        if (looksSynthetic(value)) {
          confidence -= 0.25;
          reasons.push('The value is repetitive or sequential, which suggests a placeholder.');
        }

        const entropy = shannonEntropy(value);
        if (entropy < 1 && value.length >= 8) {
          // A long value with almost no variety — all zeros, all x's — cannot be
          // a live credential whatever else the pattern matched.
          confidence -= 0.35;
          reasons.push('The value has almost no character variety, so it cannot be a live credential.');
        } else if (entropy >= 4 && value.length >= 20) {
          confidence += 0.05;
          reasons.push(`The value is long and high-entropy (${entropy.toFixed(2)} bits per character).`);
        } else if (entropy < 2.5 && value.length < 16) {
          confidence -= 0.15;
          reasons.push('The value is short and low-entropy, which is unusual for a live credential.');
        }

        matches.push({
          kind,
          line: index + 1,
          column: match.index + 1,
          endColumn: match.index + match[0].length + 1,
          // Redaction happens here, at the boundary. Nothing downstream sees raw.
          redactedExcerpt: redactText(line.trim()).slice(0, 240),
          maskedValue: maskSecret(value),
          confidence: Math.round(Math.min(0.95, Math.max(0.1, confidence)) * 100) / 100,
          reasons,
        });

        if (pattern.lastIndex === match.index) pattern.lastIndex += 1;
      }
    }
  }

  return deduplicate(matches);
}

/**
 * Drops a match whose span is covered by a stronger one on the same line.
 *
 * Patterns overlap by design — a Discord webhook is also a generic webhook —
 * and reporting one secret twice would both overstate the problem and make the
 * operator's remediation list wrong.
 */
function deduplicate(matches: readonly SecretMatch[]): SecretMatch[] {
  // Specificity first, then confidence. Ranking by confidence alone would keep
  // a generic match over a specific one precisely when the specific pattern had
  // found evidence that the value is a placeholder — the opposite of useful.
  const ranked = [...matches].sort(
    (a, b) => SPECIFICITY[b.kind] - SPECIFICITY[a.kind] || b.confidence - a.confidence || a.column - b.column,
  );
  const kept: SecretMatch[] = [];

  for (const candidate of ranked) {
    const overlapped = kept.some(
      (existing) =>
        existing.line === candidate.line &&
        candidate.column < existing.endColumn &&
        existing.column < candidate.endColumn,
    );
    if (!overlapped) kept.push(candidate);
  }

  return kept.sort((a, b) => a.line - b.line || a.column - b.column);
}

/** Human-readable description of a secret kind, for finding titles. */
export const SECRET_KIND_LABELS: Readonly<Record<SecretKind, string>> = Object.freeze({
  DISCORD_WEBHOOK: 'Discord webhook endpoint',
  GENERIC_WEBHOOK: 'webhook endpoint',
  PRIVATE_KEY: 'private key',
  JWT: 'JSON Web Token',
  DISCORD_BOT_TOKEN: 'Discord bot token',
  URI_CREDENTIALS: 'credentials in a connection URI',
  AUTHORIZATION_HEADER: 'authorization header value',
  API_KEY: 'API key',
  PASSWORD: 'password',
  LICENSE_KEY: 'license key',
  HIGH_ENTROPY_ASSIGNMENT: 'high-entropy credential-shaped value',
});

/** Kinds that are webhook endpoints, reported under SEC-WEBHOOK-001. */
export const WEBHOOK_KINDS: ReadonlySet<SecretKind> = new Set(['DISCORD_WEBHOOK', 'GENERIC_WEBHOOK']);
