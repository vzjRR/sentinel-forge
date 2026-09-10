/**
 * Manifest token vocabulary.
 *
 * A manifest is Lua, so it is lexed by `@sentinel-forge/lua` — the same lexer
 * that reads resource scripts. Keeping one lexer means manifest parsing and
 * script analysis cannot drift apart on what a Lua string or comment is.
 *
 * This module maps the general Lua token stream onto the small vocabulary the
 * manifest parser works in. The mapping is deliberately narrow: a manifest is
 * declarative, and the parser should not have to reason about operators or
 * keywords it will never act on.
 */

import { lexLua, type LuaToken } from '@sentinel-forge/lua';

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
  readonly raw: string;
  /** Decoded value: string contents for STRING, source text otherwise. */
  readonly value: string;
  readonly line: number;
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

const PUNCTUATION_TOKENS: Readonly<Record<string, TokenType>> = Object.freeze({
  '{': 'LBRACE',
  '}': 'RBRACE',
  '(': 'LPAREN',
  ')': 'RPAREN',
  '[': 'LBRACKET',
  ']': 'RBRACKET',
  ',': 'COMMA',
  ';': 'SEMICOLON',
});

function mapToken(token: LuaToken): TokenType {
  switch (token.type) {
    case 'STRING':
      return 'STRING';
    case 'NUMBER':
      return 'NUMBER';
    // A manifest directive name and a Lua keyword are lexically the same thing
    // here; the parser decides what a name means.
    case 'NAME':
    case 'KEYWORD':
      return 'NAME';
    case 'EOF':
      return 'EOF';
    case 'PUNCTUATION':
      return PUNCTUATION_TOKENS[token.value] ?? 'UNKNOWN';
    case 'OPERATOR':
      if (token.value === '=') return 'EQUALS';
      if (token.value === '..') return 'CONCAT';
      return 'UNKNOWN';
    case 'UNKNOWN':
      return 'UNKNOWN';
    default:
      return 'UNKNOWN';
  }
}

export function lex(source: string): LexResult {
  const result = lexLua(source);
  return {
    tokens: result.tokens.map((token) => ({
      type: mapToken(token),
      raw: token.raw,
      value: token.value,
      line: token.line,
      column: token.column,
    })),
    diagnostics: result.diagnostics.map((diagnostic) => ({
      message: diagnostic.message,
      line: diagnostic.line,
      column: diagnostic.column,
    })),
  };
}
