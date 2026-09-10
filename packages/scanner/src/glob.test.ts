import { describe, expect, it } from 'vitest';
import { globToRegExp, isGlob, matchGlob } from './glob.js';

const FILES = [
  'fxmanifest.lua',
  'client.lua',
  'client/main.lua',
  'client/ui/hud.lua',
  'client/cl_util.lua',
  'server/main.lua',
  'html/index.html',
  'html/js/app.js',
  'stream/props.ytyp',
];

describe('glob matching', () => {
  it('recognises which patterns are globs', () => {
    expect(isGlob('client.lua')).toBe(false);
    expect(isGlob('client/*.lua')).toBe(true);
    expect(isGlob('client/**/*.lua')).toBe(true);
    expect(isGlob('cl_?.lua')).toBe(true);
  });

  it('matches a literal path exactly', () => {
    expect(matchGlob('client.lua', FILES)).toEqual(['client.lua']);
    expect(matchGlob('nope.lua', FILES)).toEqual([]);
  });

  it('matches a single star without crossing directory separators', () => {
    expect(matchGlob('client/*.lua', FILES)).toEqual(['client/main.lua', 'client/cl_util.lua']);
    expect(matchGlob('*.lua', FILES)).toEqual(['fxmanifest.lua', 'client.lua']);
  });

  it('matches a double star across directories', () => {
    expect(matchGlob('client/**/*.lua', FILES)).toEqual(['client/main.lua', 'client/ui/hud.lua', 'client/cl_util.lua']);
    expect(matchGlob('**/*.lua', FILES).length).toBe(6);
  });

  it('supports a recursive prefix match', () => {
    expect(matchGlob('**/cl_*.lua', FILES)).toEqual(['client/cl_util.lua']);
  });

  it('matches a bare double star against everything below a directory', () => {
    expect(matchGlob('html/**', FILES)).toEqual(['html/index.html', 'html/js/app.js']);
  });

  it('matches a single character with ?', () => {
    expect(matchGlob('client/ui/hu?.lua', FILES)).toEqual(['client/ui/hud.lua']);
  });

  it('escapes regular expression metacharacters in the literal parts', () => {
    expect(globToRegExp('a.b+c(d).lua').test('a.b+c(d).lua')).toBe(true);
    expect(globToRegExp('a.b+c(d).lua').test('axbxcxdxlua')).toBe(false);
  });

  it('treats backslashes as separators so Windows-style declarations still match', () => {
    expect(matchGlob('client\\main.lua', FILES)).toEqual(['client/main.lua']);
  });
});
