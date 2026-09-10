import { describe, expect, it } from 'vitest';
import { isCategoryName, parseServerConfig, resolveStartedResources, tokenizeConfigLine } from './server-config.js';

const CONFIG = [
  '# Fixture configuration',
  'endpoint_add_tcp "0.0.0.0:30120"',
  'sv_hostname "A fixture server"',
  '',
  'ensure sf_core',
  'start sf_hud',
  'ensure [managers]',
  'stop sf_legacy',
  '',
  'set mysql_slow_query_warning 150',
  'sets sv_projectName "Fixture"',
  'setr sv_enforceGameBuild 2699',
  'exec resources/extra.cfg',
  '// a comment line',
].join('\n');

describe('server configuration parsing', () => {
  const parsed = parseServerConfig(CONFIG);

  it('collects resource directives with their line numbers', () => {
    expect(parsed.resourceDirectives.map((directive) => `${directive.command} ${directive.target}`)).toEqual([
      'ensure sf_core',
      'start sf_hud',
      'ensure [managers]',
      'stop sf_legacy',
    ]);
    expect(parsed.resourceDirectives[0]?.line).toBe(5);
  });

  it('marks a category target, which affects a group rather than naming a resource', () => {
    expect(isCategoryName('[managers]')).toBe(true);
    expect(isCategoryName('sf_core')).toBe(false);
    expect(parsed.resourceDirectives[2]?.isCategory).toBe(true);
  });

  it('collects set, sets and setr variables', () => {
    expect(parsed.variables.map((variable) => `${variable.command}:${variable.name}`)).toEqual([
      'set:mysql_slow_query_warning',
      'sets:sv_projectName',
      'setr:sv_enforceGameBuild',
    ]);
    expect(parsed.variables[1]?.value).toBe('Fixture');
  });

  it('collects exec directives', () => {
    expect(parsed.execs.map((exec) => exec.target)).toEqual(['resources/extra.cfg']);
  });

  it('resolves which resources the configuration starts', () => {
    expect(resolveStartedResources(parsed)).toEqual(['sf_core', 'sf_hud']);
  });

  it('honours a stop that follows a start', () => {
    const config = parseServerConfig(['ensure sf_core', 'stop sf_core'].join('\n'));
    expect(resolveStartedResources(config)).toEqual([]);
  });

  it('tokenizes quoted arguments and strips comments', () => {
    expect(tokenizeConfigLine('sv_hostname "My Server"')).toEqual(['sv_hostname', 'My Server']);
    expect(tokenizeConfigLine("set key 'a value' # trailing")).toEqual(['set', 'key', 'a value']);
    expect(tokenizeConfigLine('# whole line')).toEqual([]);
    expect(tokenizeConfigLine('// whole line')).toEqual([]);
  });

  it('ignores blank and unknown lines without failing', () => {
    expect(() => parseServerConfig('\n\n   \nnot_a_known_command x y z\n')).not.toThrow();
  });

  it('handles CRLF line endings, which Windows configurations use', () => {
    const config = parseServerConfig('ensure sf_core\r\nensure sf_hud\r\n');
    expect(config.resourceDirectives.map((directive) => directive.target)).toEqual(['sf_core', 'sf_hud']);
  });
});
