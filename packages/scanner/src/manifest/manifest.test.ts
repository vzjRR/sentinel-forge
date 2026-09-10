import { describe, expect, it } from 'vitest';
import { analyzeManifest, splitExternalReference } from './manifest.js';

const FULL_MANIFEST = [
  "fx_version 'cerulean'",
  "game 'gta5'",
  '',
  "author 'Fixture author'",
  "description 'A fixture resource.'",
  "version '1.2.3'",
  '',
  "shared_script '@ox_lib/init.lua'",
  'client_scripts {',
  "  'client/main.lua',",
  "  'client/ui.lua'",
  '}',
  "server_script 'server/main.lua'",
  '',
  "ui_page 'html/index.html'",
  'files {',
  "  'html/index.html',",
  "  'html/**/*'",
  '}',
  '',
  'dependencies {',
  "  'oxmysql',",
  "  '/server:5104',",
  "  '/onesync'",
  '}',
  '',
  "provide 'mysql-async'",
  "data_file 'DLC_ITYP_REQUEST' 'stream/props.ytyp'",
].join('\n');

describe('manifest model', () => {
  const manifest = analyzeManifest(FULL_MANIFEST);

  it('extracts metadata declarations', () => {
    expect(manifest.fxVersion?.value).toBe('cerulean');
    expect(manifest.games.map((game) => game.value)).toEqual(['gta5']);
    expect(manifest.version?.value).toBe('1.2.3');
    expect(manifest.author?.value).toBe('Fixture author');
  });

  it('collects scripts by kind, in declaration order', () => {
    expect(manifest.scripts.map((script) => `${script.kind}:${script.pattern}`)).toEqual([
      'shared:init.lua',
      'client:client/main.lua',
      'client:client/ui.lua',
      'server:server/main.lua',
    ]);
  });

  it('records the resource named by an @resource reference', () => {
    const shared = manifest.scripts[0];
    expect(shared?.externalResource).toBe('ox_lib');
    expect(shared?.pattern).toBe('init.lua');
  });

  it('separates runtime constraints from resource dependencies', () => {
    expect(manifest.dependencies.map((dependency) => dependency.name)).toEqual(['oxmysql', '/server:5104', '/onesync']);
    expect(manifest.dependencies.filter((dependency) => !dependency.isRuntimeConstraint)).toHaveLength(1);
    expect(manifest.dependencies[1]?.isRuntimeConstraint).toBe(true);
  });

  it('records provided names, which satisfy other resources dependencies', () => {
    expect(manifest.provides.map((entry) => entry.value)).toEqual(['mysql-async']);
  });

  it('takes the path from the second value of data_file', () => {
    expect(manifest.dataFiles.map((entry) => entry.value)).toEqual(['stream/props.ytyp']);
  });

  it('keeps files and ui_page declarations', () => {
    expect(manifest.files.map((file) => file.pattern)).toEqual(['html/index.html', 'html/**/*']);
    expect(manifest.uiPage?.value).toBe('html/index.html');
  });

  it('accepts the plural games form', () => {
    const plural = analyzeManifest("games { 'gta5', 'rdr3' }");
    expect(plural.games.map((game) => game.value)).toEqual(['gta5', 'rdr3']);
  });

  it('splits @resource references', () => {
    expect(splitExternalReference('@ox_lib/init.lua')).toEqual({ resource: 'ox_lib', path: 'init.lua' });
    expect(splitExternalReference('@ox_lib')).toEqual({ resource: 'ox_lib', path: '' });
    expect(splitExternalReference('client.lua')).toBeNull();
  });

  it('returns an empty model for an empty manifest rather than failing', () => {
    const empty = analyzeManifest('');
    expect(empty.scripts).toEqual([]);
    expect(empty.fxVersion).toBeUndefined();
  });
});
