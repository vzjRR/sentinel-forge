import { describe, expect, it } from 'vitest';
import { lex } from './lexer.js';

function values(source: string): string[] {
  return lex(source)
    .tokens.filter((token) => token.type === 'STRING')
    .map((token) => token.value);
}

describe('manifest lexer', () => {
  it('reads single- and double-quoted strings', () => {
    expect(values(`fx_version 'cerulean'\ngame "gta5"`)).toEqual(['cerulean', 'gta5']);
  });

  it('reads long-bracket strings, including levelled ones', () => {
    expect(values('description [[a long value]]')).toEqual(['a long value']);
    expect(values('description [==[nested ]] inside]==]')).toEqual(['nested ]] inside']);
  });

  it('skips line comments and long comments', () => {
    const source = [
      '-- a line comment',
      "fx_version 'cerulean' -- trailing comment",
      '--[[ a long',
      "   comment with 'quotes' ]]",
      "game 'gta5'",
    ].join('\n');
    expect(values(source)).toEqual(['cerulean', 'gta5']);
  });

  it('records 1-based line and column for every token', () => {
    const tokens = lex("fx_version 'cerulean'\ngame 'gta5'").tokens;
    expect(tokens[0]).toMatchObject({ type: 'NAME', value: 'fx_version', line: 1, column: 1 });
    expect(tokens[1]).toMatchObject({ type: 'STRING', value: 'cerulean', line: 1, column: 12 });
    expect(tokens[2]).toMatchObject({ type: 'NAME', value: 'game', line: 2, column: 1 });
  });

  it('decodes escape sequences', () => {
    expect(values(`description 'line\\nbreak'`)).toEqual(['line\nbreak']);
    expect(values(`description 'it\\'s here'`)).toEqual(["it's here"]);
    expect(values(`description "a\\\\b"`)).toEqual(['a\\b']);
  });

  it('reports an unterminated string and keeps the earlier tokens usable', () => {
    const result = lex("fx_version 'cerulean'\nclient_script 'unterminated\ngame 'gta5'");
    expect(result.diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(result.diagnostics[0]).toMatchObject({ line: 2, column: 15 });
    expect(result.tokens.some((token) => token.value === 'cerulean')).toBe(true);
  });

  it('reports an unterminated long comment', () => {
    const result = lex("fx_version 'cerulean'\n--[[ never closed");
    expect(result.diagnostics[0]?.message).toContain('long comment');
  });

  it('distinguishes a table index from a long string', () => {
    const tokens = lex("files { [1] = 'a.lua' }").tokens.map((token) => token.type);
    expect(tokens).toContain('LBRACKET');
    expect(tokens).toContain('NUMBER');
  });

  it('always terminates with EOF and never throws on hostile input', () => {
    const hostile = ['', '   ', '[[', '--[==[', "'", '\\', '{{{{{{', 'x'.repeat(10_000)];
    for (const source of hostile) {
      const result = lex(source);
      expect(result.tokens[result.tokens.length - 1]?.type, JSON.stringify(source.slice(0, 10))).toBe('EOF');
    }
  });
});
