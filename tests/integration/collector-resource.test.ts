/**
 * The collector, analysed by the product that ships it.
 *
 * `sentinel_doctor` runs inside someone else's server. Every constraint its
 * documentation claims — no network access, no writes outside its own resource
 * directory, no player identity, no code execution — is asserted here against
 * the actual source, using the same Lua analysis Sentinel Forge applies to
 * third-party resources.
 *
 * A promise in a README is not a control. This file is.
 *
 * There is no Lua interpreter in this suite and the collector is never
 * executed: the source is read as data, exactly as a scanned resource is.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { extractCalls, lexLua } from '@sentinel-forge/lua';
import { analyzeManifest } from '@sentinel-forge/scanner';
import { scanSecrets } from '@sentinel-forge/security';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const collectorRoot = path.join(repositoryRoot, 'resources', 'sentinel_doctor');

const SCRIPTS = ['server/config.lua', 'server/collector.lua', 'server/writer.lua', 'server/main.lua'] as const;

async function readScript(relative: string): Promise<string> {
  return readFile(path.join(collectorRoot, relative), 'utf8');
}

async function callNames(): Promise<Set<string>> {
  const names = new Set<string>();
  for (const script of SCRIPTS) {
    for (const call of extractCalls(lexLua(await readScript(script)).tokens)) {
      names.add(call.name);
    }
  }
  return names;
}

/**
 * Natives and functions that would break one of the collector's stated
 * constraints. A diagnostic tool with any of these in it is not a diagnostic
 * tool any more, and an operator installing it on a live server is entitled to
 * that guarantee being checked rather than asserted.
 */
const FORBIDDEN: Readonly<Record<string, string>> = Object.freeze({
  PerformHttpRequest: 'makes a network request',
  load: 'executes code built at runtime',
  loadstring: 'executes code built at runtime',
  dofile: 'executes a file',
  loadfile: 'loads a file as code',
  require: 'loads code from outside the resource',
  os_execute: 'executes a shell command',
  io_open: 'opens a file outside the resource API',
  io_popen: 'executes a shell command',
  ExecuteCommand: 'executes a server command',
  StopResource: 'changes another resource\'s state',
  StartResource: 'changes another resource\'s state',
  SetResourceKvp: 'writes outside its own resource directory',
  DeleteResourceKvp: 'deletes state it did not create',
  TriggerClientEvent: 'sends data to players',
  TriggerLatentClientEvent: 'sends data to players',
  GetPlayerIdentifiers: 'reads player identity',
  GetPlayerName: 'reads player identity',
  GetPlayerEndpoint: 'reads a player network address',
  GetPlayerPed: 'reads player state',
  GetEntityCoords: 'reads player position',
  GetPlayerToken: 'reads player identity',
  GetPlayerGuid: 'reads player identity',
});

describe('sentinel_doctor manifest', () => {
  it('parses with the product\'s own manifest parser, with no problems', async () => {
    const manifest = analyzeManifest(await readFile(path.join(collectorRoot, 'fxmanifest.lua'), 'utf8'));

    expect(manifest.problems).toEqual([]);
    expect(manifest.fxVersion?.value).toBe('cerulean');
    expect(manifest.version?.value).toBeDefined();
  });

  it('declares every script it ships, and ships every script it declares', async () => {
    const manifest = analyzeManifest(await readFile(path.join(collectorRoot, 'fxmanifest.lua'), 'utf8'));
    const declared = manifest.scripts.map((script) => script.pattern);

    expect(declared).toEqual([...SCRIPTS]);
    for (const script of SCRIPTS) {
      await expect(readScript(script)).resolves.toContain('Sentinel Forge');
    }
  });

  it('is server-side only: no client script is declared', async () => {
    const manifest = analyzeManifest(await readFile(path.join(collectorRoot, 'fxmanifest.lua'), 'utf8'));
    expect(manifest.scripts.filter((script) => script.kind !== 'server')).toEqual([]);
  });

  it('declares no dependency, so installing it cannot break a resource order', async () => {
    const manifest = analyzeManifest(await readFile(path.join(collectorRoot, 'fxmanifest.lua'), 'utf8'));
    expect(manifest.dependencies).toEqual([]);
  });
});

describe('sentinel_doctor constraints', () => {
  it('calls nothing that would breach a stated constraint', async () => {
    const called = await callNames();
    const breaches: string[] = [];

    for (const name of called) {
      // `os.execute` lexes as the qualified name `os.execute`; the table maps
      // the underscored form, so both spellings are checked.
      const key = name.replace(/[.:]/g, '_');
      const reason = FORBIDDEN[key] ?? FORBIDDEN[name];
      if (reason !== undefined) breaches.push(`${name} — ${reason}`);
    }

    expect(breaches).toEqual([]);
  });

  it('writes only through SaveResourceFile, into its own resource', async () => {
    const writer = await readScript('server/writer.lua');
    const calls = extractCalls(lexLua(writer).tokens);

    const save = calls.find((call) => call.name === 'SaveResourceFile');
    expect(save, 'the writer must use SaveResourceFile').toBeDefined();

    // The destination resource is GetCurrentResourceName(), never a literal or
    // a value from elsewhere: a collector that can name its target can write
    // into any resource on the server.
    expect(writer).toContain('local resourceName = GetCurrentResourceName()');
    expect(writer).toContain('SaveResourceFile(resourceName,');
  });

  it('reads a player count and nothing else about players', async () => {
    const called = await callNames();
    const playerCalls = [...called].filter((name) => name.includes('Player') || name.includes('Ped'));

    // GetNumPlayerIndices returns a count. It is the only player-facing native
    // in the collector, and the only one it is allowed to gain.
    expect(playerCalls).toEqual(['GetNumPlayerIndices']);
  });

  it('registers a status command and no command that changes anything', async () => {
    const main = await readScript('server/main.lua');
    const registered = extractCalls(lexLua(main).tokens).filter((call) => call.name === 'RegisterCommand');

    expect(registered).toHaveLength(1);
    expect(registered[0]?.stringArguments).toEqual(['sentinel_doctor']);
  });

  it('handles only the two resource lifecycle events it documents', async () => {
    const main = await readScript('server/main.lua');
    const handlers = extractCalls(lexLua(main).tokens)
      .filter((call) => call.name === 'AddEventHandler')
      .flatMap((call) => call.stringArguments);

    expect([...new Set(handlers)].sort()).toEqual(['onResourceStart', 'onResourceStop']);
  });

  it('bounds every buffer it keeps', async () => {
    const collector = await readScript('server/collector.lua');

    // Both buffers are checked against the configured bound before an append.
    // An unbounded buffer in a process that runs for weeks is a memory leak,
    // and a memory leak in a diagnostic tool is an outage it caused itself.
    expect(collector).toContain('if #samples >= SentinelConfig.maxBufferedSamples then');
    expect(collector).toContain('if #events >= SentinelConfig.maxBufferedSamples then');
    expect(collector).toContain('dropped.samples = dropped.samples + 1');
    expect(collector).toContain('dropped.events = dropped.events + 1');
  });

  it('never reports a negative latency, which would be noise presented as data', async () => {
    const collector = await readScript('server/collector.lua');
    expect(collector).toContain('if lateness < 0 then');
  });

  it('reports no per-resource timing anywhere', async () => {
    // The central honesty constraint of the whole gate: FiveM exposes no
    // scripting API for another resource's CPU or tick time, so no metric
    // claiming to be one may exist.
    for (const script of SCRIPTS) {
      const source = await readScript(script);
      const metrics = extractCalls(lexLua(source).tokens)
        .filter((call) => call.name === 'Collector.addSample')
        .flatMap((call) => call.stringArguments);

      for (const metric of metrics) {
        expect(metric).not.toMatch(/cpu|tick|resource_time|ms_per_resource/i);
      }
    }
  });

  it('states the limitation in the telemetry it writes, not only in its README', async () => {
    const writer = await readScript('server/writer.lua');
    expect(writer).toContain('FiveM exposes no scripting API for per-resource CPU or tick time');
  });

  it('carries no credential of any kind', async () => {
    for (const script of [...SCRIPTS, 'fxmanifest.lua']) {
      const source = await readFile(path.join(collectorRoot, script), 'utf8');
      const found = scanSecrets(source, { filePath: script });
      expect(found, `${script} must contain no credential`).toEqual([]);
    }
  });

  it('every convar it reads is documented in its README', async () => {
    const config = await readScript('server/config.lua');
    const readme = await readFile(path.join(collectorRoot, 'README.md'), 'utf8');

    const convars = extractCalls(lexLua(config).tokens)
      .filter((call) => call.name === 'intConvar' || call.name === 'boolConvar')
      .flatMap((call) => call.stringArguments);

    expect(convars.length).toBeGreaterThan(0);
    for (const convar of convars) {
      expect(readme, `${convar} must be documented`).toContain(`\`${convar}\``);
    }
  });
});
