import { describe, expect, it } from 'vitest';
import { lexLua } from './lexer.js';
import { analyzeStructure, bodyTokens, enclosingLoop, isContinuousCondition } from './structure.js';

function structureOf(source: string): ReturnType<typeof analyzeStructure> {
  return analyzeStructure(lexLua(source).tokens);
}

describe('Lua block structure', () => {
  it('finds a while loop and its body range', () => {
    const source = ['while true do', '  Wait(0)', 'end'].join('\n');
    const { loops } = structureOf(source);
    expect(loops).toHaveLength(1);
    expect(loops[0]).toMatchObject({ kind: 'WHILE', line: 1, unterminated: false });
    expect(bodyTokens(lexLua(source).tokens, loops[0]!).map((token) => token.value)).toContain('Wait');
  });

  it('finds for and repeat loops', () => {
    expect(structureOf('for i = 1, 10 do print(i) end').loops[0]?.kind).toBe('FOR');
    expect(structureOf('repeat x = x + 1 until x > 10').loops[0]?.kind).toBe('REPEAT');
  });

  it('reports nested loops with their depth', () => {
    const { loops } = structureOf('while true do for i = 1, 10 do print(i) end end');
    expect(loops.map((loop) => loop.kind)).toEqual(['WHILE', 'FOR']);
    expect(loops[1]?.depth).toBe(1);
  });

  it('keeps the stack balanced across if/elseif/else chains', () => {
    const source = ['if a then', '  x()', 'elseif b then', '  y()', 'else', '  z()', 'end'].join('\n');
    expect(structureOf(source).unbalanced).toBe(false);
  });

  it('handles a function inside a loop without confusing their bodies', () => {
    const source = ['while true do', '  local f = function() return 1 end', '  Wait(0)', 'end'].join('\n');
    const { loops, unbalanced } = structureOf(source);
    expect(unbalanced).toBe(false);
    expect(loops).toHaveLength(1);
    expect(bodyTokens(lexLua(source).tokens, loops[0]!).map((token) => token.value)).toContain('Wait');
  });

  it('flags unbalanced source rather than silently producing wrong ranges', () => {
    const { unbalanced, loops } = structureOf('while true do\n  Wait(0)');
    expect(unbalanced).toBe(true);
    expect(loops[0]?.unterminated).toBe(true);
  });

  it('recognises a condition that can never end the loop', () => {
    const whileTrue = structureOf('while true do end').loops[0];
    expect(isContinuousCondition('WHILE', whileTrue?.conditionTokens ?? [])).toBe(true);

    const whileCond = structureOf('while running do end').loops[0];
    expect(isContinuousCondition('WHILE', whileCond?.conditionTokens ?? [])).toBe(false);

    const forLoop = structureOf('for i = 1, 10 do end').loops[0];
    expect(isContinuousCondition('FOR', forLoop?.conditionTokens ?? [])).toBe(false);
  });

  it('places the first token of a body inside the loop', () => {
    // A per-iteration call is frequently the very first token in the body.
    const source = ['for i = 1, 10 do', '  query(i)', 'end'].join('\n');
    const tokens = lexLua(source).tokens;
    const { loops } = analyzeStructure(tokens);
    const queryToken = tokens.find((token) => token.value === 'query');
    expect(enclosingLoop(loops, queryToken?.index ?? -1)).toBeDefined();
  });

  it('returns the innermost loop for a nested position', () => {
    const source = ['while true do', '  for i = 1, 3 do', '    inner()', '  end', 'end'].join('\n');
    const tokens = lexLua(source).tokens;
    const { loops } = analyzeStructure(tokens);
    const inner = tokens.find((token) => token.value === 'inner');
    expect(enclosingLoop(loops, inner?.index ?? -1)?.kind).toBe('FOR');
  });
});
