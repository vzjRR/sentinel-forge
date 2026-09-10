/**
 * Lexer for FiveM resource manifests.
 *
 * A manifest (`fxmanifest.lua`, or the legacy `__resource.lua`) is a Lua file
 * written in a semi-declarative style. Sentinel Forge never executes it: a
 * manifest is data, and running it would mean running code from a resource the
 * operator has not yet reviewed — exactly what the tool exists to avoid.
 *
 * This lexer covers the Lua lexical grammar the manifest format uses: names,
 * string literals in all three Lua forms, numbers, and the punctuation that
 * appears in table constructors and call syntax. Anything outside that subset is
 * emitted as an `UNKNOWN` token so the parser can skip a statement it does not
 * recognise instead of failing the whole file.
 *
 * Reference: https://docs.fivem.net/docs/scripting-reference/resource-manifest/
 */

export type TokenType =
  | 'NAME'
  | 'STRING'
  | 'NUMBER'
  | 'LBRACE'
  | 'RBRACE'
  | 'LPAREN'
  | 'RPAREN'
  | 'LBRACKET'
  | 'RBRACKET'
  | 'COMMA'
  | 'SEMICOLON'
  | 'EQUALS'
  | 'CONCAT'
  | 'UNKNOWN'
  | 'EOF';

export interface Token {
  readonly type: TokenType;
  /** Raw source text of the token. */
  readonly raw: string;
  /** Decoded value: the string contents for STRING, the source text otherwise. */
  readonly value: string;
  /** 1-based line of the token's first character. */
  readonly line: number;
  /** 1-based column of the token's first character. */
  readonly column: number;
}

export interface LexerDiagnostic {
  readonly message: string;
  readonly line: number;
  readonly column: number;
}

export interface LexResult {
  readonly tokens: readonly Token[];
  /**
   * Lexical problems found. A diagnostic does not stop lexing: an unterminated
   * string near the end of a file should still leave the earlier declarations
   * usable, so a broken manifest yields one precise finding rather than
   * "the file could not be read".
   */
  readonly diagnostics: readonly LexerDiagnostic[];
}

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

export function lex(source: string): LexResult {
  const tokens: Token[] = [];
  const diagnostics: LexerDiagnostic[] = [];

  let index = 0;
  let line = 1;
  let column = 1;

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

  /**
   * Reads a Lua long bracket (`[[...]]`, `[==[...]==]`) at the current position.
   * Returns `null` when this is not a long-bracket opener, which is how `[` is
   * distinguished from a table index.
   */
  const readLongBracket = (): { raw: string; value: string; terminated: boolean } | null => {
    if (peek() !== '[') return null;
    let level = 0;
    while (peek(1 + level) === '=') level += 1;
    if (peek(1 + level) !== '[') return null;

    const raw: string[] = [advance(2 + level)];
    const closing = `]${'='.repeat(level)}]`;
    const contentStart = index;

    const closeIndex = source.indexOf(closing, index);
    if (closeIndex === -1) {
      raw.push(advance(source.length - index));
      return { raw: raw.join(''), value: source.slice(contentStart), terminated: false };
    }

    const value = source.slice(contentStart, closeIndex);
    raw.push(advance(closeIndex - index));
    raw.push(advance(closing.length));
    return { raw: raw.join(''), value, terminated: true };
  };

  const readQuotedString = (startLine: number, startColumn: number): Token => {
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
          // Decimal escape: up to three digits.
          let digits = '';
          while (digits.length < 3 && DIGIT.test(peek())) {
            digits += advance();
          }
          raw.push(digits);
          value.push(String.fromCharCode(Number.parseInt(digits, 10)));
          continue;
        }
        // Unrecognised escape: keep the character as written rather than guessing.
        raw.push(advance());
        value.push(escape);
        continue;
      }

      if (character === quote) {
        raw.push(advance());
        terminated = true;
        break;
      }

      if (character === '\n') {
        // A raw newline terminates a quoted string in Lua. Report it at the
        // opening quote, which is where the author needs to look.
        break;
      }

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

    return { type: 'STRING', raw: raw.join(''), value: value.join(''), line: startLine, column: startColumn };
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
            diagnostics.push({
              message: 'Unterminated long comment.',
              line: commentLine,
              column: commentColumn,
            });
          }
          continue;
        }

        while (index < source.length && peek() !== '\n') advance();
        continue;
      }

      return;
    }
  };

  const PUNCTUATION: Readonly<Partial<Record<string, TokenType>>> = Object.freeze({
    '{': 'LBRACE',
    '}': 'RBRACE',
    '(': 'LPAREN',
    ')': 'RPAREN',
    ']': 'RBRACKET',
    ',': 'COMMA',
    ';': 'SEMICOLON',
    '=': 'EQUALS',
  });

  while (index < source.length) {
    skipTrivia();
    if (index >= source.length) break;

    const startLine = line;
    const startColumn = column;
    const character = peek();

    if (character === "'" || character === '"') {
      tokens.push(readQuotedString(startLine, startColumn));
      continue;
    }

    if (character === '[') {
      const long = readLongBracket();
      if (long !== null) {
        if (!long.terminated) {
          diagnostics.push({
            message: 'Unterminated long string literal.',
            line: startLine,
            column: startColumn,
          });
        }
        tokens.push({ type: 'STRING', raw: long.raw, value: long.value, line: startLine, column: startColumn });
        continue;
      }
      tokens.push({ type: 'LBRACKET', raw: advance(), value: '[', line: startLine, column: startColumn });
      continue;
    }

    if (NAME_START.test(character)) {
      let name = '';
      while (index < source.length && NAME_PART.test(peek())) name += advance();
      tokens.push({ type: 'NAME', raw: name, value: name, line: startLine, column: startColumn });
      continue;
    }

    if (DIGIT.test(character)) {
      let number = '';
      while (index < source.length && /[0-9a-fA-FxX.+\-eE]/.test(peek())) {
        // Stop before a `-` that begins a comment rather than an exponent sign.
        if (peek() === '-' && peek(1) === '-') break;
        number += advance();
      }
      tokens.push({ type: 'NUMBER', raw: number, value: number, line: startLine, column: startColumn });
      continue;
    }

    if (character === '.' && peek(1) === '.') {
      tokens.push({ type: 'CONCAT', raw: advance(2), value: '..', line: startLine, column: startColumn });
      continue;
    }

    const type = PUNCTUATION[character];
    if (type !== undefined) {
      tokens.push({ type, raw: advance(), value: character, line: startLine, column: startColumn });
      continue;
    }

    tokens.push({ type: 'UNKNOWN', raw: advance(), value: character, line: startLine, column: startColumn });
  }

  tokens.push({ type: 'EOF', raw: '', value: '', line, column });
  return { tokens, diagnostics };
}
