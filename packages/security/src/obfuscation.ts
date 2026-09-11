/**
 * Obfuscation indicators.
 *
 * Obfuscated code is not malicious code. Commercial FiveM resources are
 * routinely obfuscated for licence protection, and treating that as an attack
 * would make the security output useless on a real server.
 *
 * What obfuscation *does* mean is that the code cannot be reviewed — which
 * matters, because every other safeguard assumes somebody could read it. So the
 * finding says exactly that, and no more.
 *
 * Detection is by density rather than by any single construct: one encoded
 * string is a data blob, hundreds are a transformation.
 */

import { lexLua, type LuaToken } from '@sentinel-forge/lua';

export interface ObfuscationIndicator {
  readonly kind:
    | 'ENCODED_STRING_DENSITY'
    | 'DECODE_CHAIN'
    | 'CHARACTER_RECONSTRUCTION'
    | 'ESCAPED_STRING_DENSITY'
    | 'LONG_SINGLE_LINE'
    | 'OPAQUE_IDENTIFIERS';
  readonly description: string;
  /** The measured value that triggered the indicator. */
  readonly value: number;
  readonly unit: string;
  readonly line?: number;
}

export interface ObfuscationAnalysis {
  readonly indicators: readonly ObfuscationIndicator[];
  /** 0–1 summary of how strongly the file looks transformed. */
  readonly score: number;
  /** True when the score clears the reporting threshold. */
  readonly reportable: boolean;
}

/** Calls that decode or expand an encoded payload. */
const DECODE_CALLS = /\b(?:FromBase64|from_base64|base64Decode|b64decode|DecodeString|Decrypt|Inflate|Decompress)\b/i;

/** Calls that execute a string as code. */
const LOAD_CALLS = /\b(?:load|loadstring|RunString|dofile)\s*\(/;

/** A Base64-looking literal of meaningful length. */
const BASE64_LITERAL = /^[A-Za-z0-9+/]{32,}={0,2}$/;

/** A literal made largely of numeric or hex escapes. */
const ESCAPED_LITERAL = /(?:\\(?:\d{1,3}|x[0-9a-fA-F]{2})){8,}/;

/** Identifiers that carry no meaning, e.g. `_0x4a2f` or `IlIlIl`. */
const OPAQUE_IDENTIFIER = /^(?:_0x[0-9a-f]+|[Il1O0]{6,}|[a-zA-Z]{1,2}\d{4,})$/;

export interface AnalyzeObfuscationOptions {
  /** Density above which encoded literals count as an indicator. */
  readonly encodedStringRatio?: number;
  /** Minimum literals before density is meaningful. */
  readonly minimumStrings?: number;
}

export function analyzeObfuscation(content: string, options: AnalyzeObfuscationOptions = {}): ObfuscationAnalysis {
  const encodedRatioThreshold = options.encodedStringRatio ?? 0.25;
  const minimumStrings = options.minimumStrings ?? 8;

  const { tokens } = lexLua(content);
  const strings = tokens.filter((token: LuaToken) => token.type === 'STRING');
  const names = tokens.filter((token: LuaToken) => token.type === 'NAME');
  const indicators: ObfuscationIndicator[] = [];

  const encoded = strings.filter((token) => BASE64_LITERAL.test(token.value));
  if (strings.length >= minimumStrings) {
    const ratio = encoded.length / strings.length;
    if (ratio >= encodedRatioThreshold) {
      indicators.push({
        kind: 'ENCODED_STRING_DENSITY',
        description: `${String(encoded.length)} of ${String(strings.length)} string literals look Base64-encoded.`,
        value: Number(ratio.toFixed(3)),
        unit: 'ratio',
        ...(encoded[0] === undefined ? {} : { line: encoded[0].line }),
      });
    }
  }

  const escaped = strings.filter((token) => ESCAPED_LITERAL.test(token.raw));
  if (escaped.length >= 3) {
    indicators.push({
      kind: 'ESCAPED_STRING_DENSITY',
      description: `${String(escaped.length)} string literals are written as long escape sequences.`,
      value: escaped.length,
      unit: 'literals',
      ...(escaped[0] === undefined ? {} : { line: escaped[0].line }),
    });
  }

  // A decode call whose result reaches a loader is the strongest single signal:
  // the code that will run is not the code on disk.
  const decodeMatch = DECODE_CALLS.exec(content);
  if (decodeMatch !== null && LOAD_CALLS.test(content)) {
    indicators.push({
      kind: 'DECODE_CHAIN',
      description: 'A decoding call and a code-loading call both appear in this file.',
      value: 1,
      unit: 'chain',
      line: lineOf(content, decodeMatch.index),
    });
  }

  const charCalls = content.match(/string\.char\s*\(/g)?.length ?? 0;
  if (charCalls >= 5) {
    indicators.push({
      kind: 'CHARACTER_RECONSTRUCTION',
      description: `${String(charCalls)} string.char calls suggest strings assembled character by character.`,
      value: charCalls,
      unit: 'calls',
    });
  }

  const longLines = content.split(/\r?\n/).filter((line) => line.length > 2000).length;
  if (longLines > 0) {
    indicators.push({
      kind: 'LONG_SINGLE_LINE',
      description: `${String(longLines)} line(s) exceed 2000 characters, which is typical of generated or minified code.`,
      value: longLines,
      unit: 'lines',
    });
  }

  if (names.length >= 20) {
    const opaque = names.filter((token) => OPAQUE_IDENTIFIER.test(token.value));
    const ratio = opaque.length / names.length;
    if (ratio >= 0.4) {
      indicators.push({
        kind: 'OPAQUE_IDENTIFIERS',
        description: `${String(opaque.length)} of ${String(names.length)} identifiers carry no meaning.`,
        value: Number(ratio.toFixed(3)),
        unit: 'ratio',
        ...(opaque[0] === undefined ? {} : { line: opaque[0].line }),
      });
    }
  }

  // Weighted so that one weak indicator is never enough on its own.
  const weights: Record<ObfuscationIndicator['kind'], number> = {
    DECODE_CHAIN: 0.45,
    ENCODED_STRING_DENSITY: 0.3,
    OPAQUE_IDENTIFIERS: 0.25,
    CHARACTER_RECONSTRUCTION: 0.2,
    ESCAPED_STRING_DENSITY: 0.2,
    LONG_SINGLE_LINE: 0.1,
  };

  const score = Math.min(1, indicators.reduce((sum, indicator) => sum + weights[indicator.kind], 0));

  return {
    indicators,
    score: Number(score.toFixed(2)),
    // One long line alone is minification, not obfuscation. Two indicators, or
    // one strong one, is the point at which review is worth asking for.
    reportable: score >= 0.3,
  };
}

function lineOf(content: string, index: number): number {
  return content.slice(0, index).split('\n').length;
}
