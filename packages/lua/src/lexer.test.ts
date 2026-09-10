import { describe, expect, it } from 'vitest';
import { lexLua, LUA_KEYWORDS } from './lexer.js';

function types(source: string): string[] {
  return lexLua(source)
    .tokens.filter((token) => token.type !== 'EOF')
    .map((token) => token.type);
}

function values(source: string, type = 'STRING'): string[] {
  return lexLua(source)
    .tokens.filter((token) => token.type === type)
    .map((token) => token.value);
}

describe('Lua lexer', () => {
  it('distinguishes keywords from names', () => {
    expect(types('local x = 1')).toEqual(['KEYWORD', 'NAME', 'OPERATOR', 'NUMBER']);
    expect(LUA_KEYWORDS.has('while')).toBe(true);
    expect(LUA_KEYWORDS.has('Wait')).toBe(false);
  });

  it('reads all three string forms', () => {
    expect(values(`a = 'single'`)).toEqual(['single']);
    expect(values('a = "double"')).toEqual(['double']);
    expect(values('a = [[long]]')).toEqual(['long']);
    expect(values('a = [==[levelled ]] inside]==]')).toEqual(['levelled ]] inside']);
  });

  it('decodes escapes, including hex and decimal', () => {
    expect(values(`a = 'tab\\there'`)).toEqual(['tab\there']);
    expect(values(`a = '\\65\\66'`)).toEqual(['AB']);
    expect(values(`a = '\\x41'`)).toEqual(['A']);
  });

  it('skips both comment forms', () => {
    expect(values("-- comment 'not a string'\na = 'real'")).toEqual(['real']);
    expect(values("--[[ block 'not a string' ]]\na = 'real'")).toEqual(['real']);
  });

  it('reads decimal and hexadecimal numbers', () => {
    expect(values('a = 0xFF', 'NUMBER')).toEqual(['0xFF']);
    expect(values('a = 1.5e3', 'NUMBER')).toEqual(['1.5e3']);
    expect(values('a = 42', 'NUMBER')).toEqual(['42']);
  });

  it('does not read a minus sign as part of a number unless it follows an exponent', () => {
    expect(values('a = 1-2', 'NUMBER')).toEqual(['1', '2']);
    expect(values('a = 1e-2', 'NUMBER')).toEqual(['1e-2']);
  });

  it('reads multi-character operators without splitting them', () => {
    expect(values('a == b', 'OPERATOR')).toEqual(['==']);
    expect(values('a ~= b', 'OPERATOR')).toEqual(['~=']);
    expect(values("a .. 'b'", 'OPERATOR')).toEqual(['..']);
    expect(values('f(...)', 'OPERATOR')).toEqual(['...']);
  });

  it('tracks 1-based line and column positions', () => {
    const tokens = lexLua("local a = 1\nWait(0)").tokens;
    expect(tokens[0]).toMatchObject({ value: 'local', line: 1, column: 1 });
    expect(tokens[4]).toMatchObject({ value: 'Wait', line: 2, column: 1 });
  });

  it('reports an unterminated string but keeps the earlier tokens', () => {
    const result = lexLua("local a = 'ok'\nlocal b = 'broken");
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.line).toBe(2);
    expect(result.tokens.some((token) => token.value === 'ok')).toBe(true);
  });

  it('stops at the token budget and says so, rather than reading an unbounded file', () => {
    const result = lexLua('a = 1 '.repeat(5000), { maxTokens: 100 });
    expect(result.truncated).toBe(true);
    expect(result.tokens.length).toBeLessThanOrEqual(101);
  });

  it('never throws on hostile input', () => {
    for (const source of ['', '[[', '--[==[', "'", '\\', '0x', '..', '{{{{', 'a'.repeat(20_000)]) {
      expect(() => lexLua(source), JSON.stringify(source.slice(0, 8))).not.toThrow();
    }
  });
});
