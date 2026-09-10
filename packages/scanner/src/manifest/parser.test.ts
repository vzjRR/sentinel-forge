import { describe, expect, it } from 'vitest';
import { normalizeDirectiveName, parseManifest } from './parser.js';

describe('manifest parser', () => {
  it('parses a directive with a single string value', () => {
    const { directives } = parseManifest("fx_version 'cerulean'");
    expect(directives).toHaveLength(1);
    expect(directives[0]).toMatchObject({ name: 'fx_version', key: 'fx_version', line: 1 });
    expect(directives[0]?.values[0]?.value).toBe('cerulean');
  });

  it('parses a table of values, keeping each entry position', () => {
    const { directives } = parseManifest("client_scripts {\n  'a.lua',\n  'b.lua'\n}");
    expect(directives[0]?.values.map((value) => value.value)).toEqual(['a.lua', 'b.lua']);
    expect(directives[0]?.values[1]?.line).toBe(3);
  });

  it('accepts call syntax', () => {
    const { directives } = parseManifest("client_script('client.lua')");
    expect(directives[0]?.values[0]?.value).toBe('client.lua');
  });

  it('collapses singular and plural directive spellings', () => {
    expect(normalizeDirectiveName('client_script')).toBe('client_scripts');
    expect(normalizeDirectiveName('dependency')).toBe('dependencies');
    expect(normalizeDirectiveName('game')).toBe('games');
    expect(normalizeDirectiveName('file')).toBe('files');
  });

  it('parses the two values of data_file', () => {
    const { directives } = parseManifest("data_file 'DLC_ITYP_REQUEST' 'stream/props.ytyp'");
    expect(directives[0]?.values.map((value) => value.value)).toEqual(['DLC_ITYP_REQUEST', 'stream/props.ytyp']);
  });

  it('reports an unknown directive without discarding it', () => {
    const result = parseManifest("some_vendor_directive 'value'");
    expect(result.problems.some((problem) => problem.kind === 'UNKNOWN_DIRECTIVE')).toBe(true);
    expect(result.directives).toHaveLength(1);
  });

  it('skips a value built by concatenation rather than reporting half of it', () => {
    const { directives } = parseManifest("client_script 'client' .. version .. '.lua'");
    expect(directives[0]?.values ?? []).toHaveLength(0);
  });

  it('ignores assignments, which are not directives', () => {
    const { directives } = parseManifest("local x = 'y'\nfx_version 'cerulean'");
    expect(directives.map((directive) => directive.key)).toContain('fx_version');
    expect(directives.some((directive) => directive.name === 'x')).toBe(false);
  });

  it('recovers from an unrecognised statement and keeps parsing', () => {
    const { directives } = parseManifest("fx_version 'cerulean'\n@@@ garbage @@@\ngame 'gta5'");
    expect(directives.map((directive) => directive.key)).toEqual(['fx_version', 'games']);
  });

  it('carries lexical problems through as manifest problems', () => {
    const { problems } = parseManifest("client_script 'unterminated");
    expect(problems[0]?.kind).toBe('UNTERMINATED_STRING');
  });

  it('never throws, whatever the input', () => {
    for (const source of ['', '{}', '}}}}', "x '", '--', 'a'.repeat(5000)]) {
      expect(() => parseManifest(source), JSON.stringify(source.slice(0, 12))).not.toThrow();
    }
  });
});
