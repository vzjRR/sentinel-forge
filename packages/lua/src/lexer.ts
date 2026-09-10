/**
 * Lua lexer.
 *
 * Sentinel Forge reads Lua that it must never run: resource manifests and
 * resource scripts both come from third parties. Everything is therefore
 * lexical and structural — the source is turned into tokens and analysed as
 * data.
 *
 * This lexer covers the Lua 5.4 lexical grammar: names, keywords, numbers
 * (decimal and hexadecimal), all three string forms, both comment forms, and
 * operators. It is deliberately total: it never throws, and malformed input
 * yields diagnostics plus whatever tokens could still be read, so a broken file
 * produces a precise finding rather than an unusable "could not read" result.
 *
 * © 2026 Talal Al Ghafri. All Rights Reserved.
 */

export type LuaTokenType =
  | 'NAME'
  | 'KEYWORD'
  | 'STRING'
  | 'NUMBER'
  | 'OPERATOR'
  | 'PUNCTUATION'
  | 'UNKNOWN'
  | 'EOF';

export interface LuaToken {
  readonly type: LuaTokenType;
  /** Decoded value: string contents for STRING, source text otherwise. */
  readonly value: string;
  /** Raw source text of the token. */
  readonly raw: string;
  /** 1-based line of the token's first character. */
  readonly line: number;
  /** 1-based column of the token's first character. */
  readonly column: number;
  /** Position of this token in the token array, for range queries. */
  readonly index: number;
}

export interface LuaDiagnostic {
  readonly message: string;
  readonly line: number;
  readonly column: number;
}

export interface LuaLexResult {
  readonly tokens: readonly LuaToken[];
  readonly diagnostics: readonly LuaDiagnostic[];
  /** True when the source was truncated by a caller-supplied token budget. */
  readonly truncated: boolean;
}

export const LUA_KEYWORDS: ReadonlySet<string> = new Set([
  'and',
  'break',
  'do',
  'else',
  'elseif',
  'end',
  'false',
  'for',
  'function',
  'goto',
  'if',
  'in',
  'local',
  'nil',
  'not',
  'or',
  'repeat',
  'return',
  'then',
  'true',
  'until',
  'while',
]);

const NAME_START = /[A-Za-z_]/;
const NAME_PART = /[A-Za-z0-9_]/;
const DIGIT = /[0-9]/;

/** Escape sequences Lua recognises inside quoted strings. */
const SIMPLE_ESCAPES: Readonly<Record<string, string>> = Object.freeze({
  a: '\u0007',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
  v: '\v',
  '\\': '\\',
  '"': '"',
  "'": "'",
  '\n': '\n',
});

/**
 * Multi-character operators, longest first so that `...` is not read as `..`
 * and `==` is not read as two assignments.
 */
const OPERATORS: readonly string[] = [
  '...',
  '//',
  '::',
  '..',
  '==',
  '~=',
  '<=',
  '>=',
  '<<',
  '>>',
  '+',
  '-',
  '*',
  '/',
  '%',
  '^',
  '#',
  '&',
  '~',
  '|',
  '<',
  '>',
  '=',
];

const PUNCTUATION = new Set(['(', ')', '{', '}', '[', ']', ';', ':', ',', '.']);

export interface LexLuaOptions {
  /**
   * Maximum number of tokens to produce. A scanned file is untrusted input, and
   * a generated or obfuscated script can be arbitrarily large; stopping at a
   * budget keeps one file from dominating a scan. Reaching it sets `truncated`,
   * so callers can report that analysis was incomplete rather than clean.
   */
  readonly maxTokens?: number;
}

/** Default token budget: roughly a 200 KB hand-written script. */
export const DEFAULT_MAX_TOKENS = 250_000;

export function lexLua(source: string, options: LexLuaOptions = {}): LuaLexResult {
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  const tokens: LuaToken[] = [];
  const diagnostics: LuaDiagnostic[] = [];

  let index = 0;
  let line = 1;
  let column = 1;
  let truncated = false;

  const peek = (offset = 0): string => source[index + offset] ?? '';

  const advance = (count = 1): string => {
    let consumed = '';
    for (let step = 0; step < count && index < source.length; step += 1) {
      const character = source[index] ?? '';
      consumed += character;
      index += 1;
      if (character === '\n') {
        line += 1;
        column = 1;
      } else {
        column += 1;
      }
    }
    return consumed;
  };

  const push = (type: LuaTokenType, value: string, raw: string, tokenLine: number, tokenColumn: number): void => {
    tokens.push({ type, value, raw, line: tokenLine, column: tokenColumn, index: tokens.length });
  };

  /**
   * Reads a Lua long bracket (`[[…]]`, `[==[…]==]`) at the current position.
   * Returns `null` when this is not a long-bracket opener, which is how `[` is
   * distinguished from an index expression.
   */
  const readLongBracket = (): { raw: string; value: string; terminated: boolean } | null => {
    if (peek() !== '[') return null;
    let level = 0;
    while (peek(1 + level) === '=') level += 1;
    if (peek(1 + level) !== '[') return null;

    const opening = advance(2 + level);
    const closing = `]${'='.repeat(level)}]`;
    const contentStart = index;
    const closeIndex = source.indexOf(closing, index);

    if (closeIndex === -1) {
      const rest = advance(source.length - index);
      return { raw: opening + rest, value: source.slice(contentStart), terminated: false };
    }

    const value = source.slice(contentStart, closeIndex);
    const body = advance(closeIndex - index);
    const close = advance(closing.length);
    return { raw: opening + body + close, value, terminated: true };
  };

  const readQuotedString = (startLine: number, startColumn: number): void => {
    const quote = peek();
    const raw: string[] = [advance()];
    const value: string[] = [];
    let terminated = false;

    while (index < source.length) {
      const character = peek();

      if (character === '\\') {
        raw.push(advance());
        const escape = peek();
        const simple = SIMPLE_ESCAPES[escape];
        if (simple !== undefined) {
          raw.push(advance());
          value.push(simple);
          continue;
        }
        if (DIGIT.test(escape)) {
          let digits = '';
          while (digits.length < 3 && DIGIT.test(peek())) digits += advance();
          raw.push(digits);
          value.push(String.fromCharCode(Number.parseInt(digits, 10)));
          continue;
        }
        if (escape === 'x') {
          raw.push(advance());
          let hex = '';
          while (hex.length < 2 && /[0-9a-fA-F]/.test(peek())) hex += advance();
          raw.push(hex);
          value.push(String.fromCharCode(Number.parseInt(hex, 16)));
          continue;
        }
        if (escape === 'z') {
          // `\z` skips the following whitespace, including newlines.
          raw.push(advance());
          while (/\s/.test(peek())) raw.push(advance());
          continue;
        }
        raw.push(advance());
        value.push(escape);
        continue;
      }

      if (character === quote) {
        raw.push(advance());
        terminated = true;
        break;
      }

      if (character === '\n') break;

      raw.push(advance());
      value.push(character);
    }

    if (!terminated) {
      diagnostics.push({
        message: `Unterminated string literal starting with ${quote}.`,
        line: startLine,
        column: startColumn,
      });
    }

    push('STRING', value.join(''), raw.join(''), startLine, startColumn);
  };

  const skipTrivia = (): void => {
    for (;;) {
      const character = peek();

      if (character === ' ' || character === '\t' || character === '\r' || character === '\n') {
        advance();
        continue;
      }

      if (character === '-' && peek(1) === '-') {
        const commentLine = line;
        const commentColumn = column;
        advance(2);

        const long = readLongBracket();
        if (long !== null) {
          if (!long.terminated) {
            diagnostics.push({ message: 'Unterminated long comment.', line: commentLine, column: commentColumn });
          }
          continue;
        }

        while (index < source.length && peek() !== '\n') advance();
        continue;
      }

      return;
    }
  };

  while (index < source.length) {
    skipTrivia();
    if (index >= source.length) break;

    if (tokens.length >= maxTokens) {
      truncated = true;
      break;
    }

    const startLine = line;
    const startColumn = column;
    const character = peek();

    if (character === "'" || character === '"') {
      readQuotedString(startLine, startColumn);
      continue;
    }

    if (character === '[') {
      const long = readLongBracket();
      if (long !== null) {
        if (!long.terminated) {
          diagnostics.push({ message: 'Unterminated long string literal.', line: startLine, column: startColumn });
        }
        push('STRING', long.value, long.raw, startLine, startColumn);
        continue;
      }
      push('PUNCTUATION', '[', advance(), startLine, startColumn);
      continue;
    }

    if (NAME_START.test(character)) {
      let name = '';
      while (index < source.length && NAME_PART.test(peek())) name += advance();
      push(LUA_KEYWORDS.has(name) ? 'KEYWORD' : 'NAME', name, name, startLine, startColumn);
      continue;
    }

    if (DIGIT.test(character) || (character === '.' && DIGIT.test(peek(1)))) {
      let number = '';
      const hexadecimal = character === '0' && (peek(1) === 'x' || peek(1) === 'X');
      if (hexadecimal) number += advance(2);
      const allowed = hexadecimal ? /[0-9a-fA-F.pP+-]/ : /[0-9.eE+-]/;
      while (index < source.length && allowed.test(peek())) {
        // A sign only continues a number directly after an exponent marker.
        if ((peek() === '+' || peek() === '-') && !/[eEpP]$/.test(number)) break;
        number += advance();
      }
      push('NUMBER', number, number, startLine, startColumn);
      continue;
    }

    if (PUNCTUATION.has(character) && character !== '.') {
      push('PUNCTUATION', character, advance(), startLine, startColumn);
      continue;
    }

    const operator = OPERATORS.find((candidate) => source.startsWith(candidate, index));
    if (operator !== undefined) {
      push('OPERATOR', operator, advance(operator.length), startLine, startColumn);
      continue;
    }

    if (character === '.') {
      push('PUNCTUATION', '.', advance(), startLine, startColumn);
      continue;
    }

    push('UNKNOWN', character, advance(), startLine, startColumn);
  }

  tokens.push({ type: 'EOF', value: '', raw: '', line, column, index: tokens.length });
  return { tokens, diagnostics, truncated };
}
