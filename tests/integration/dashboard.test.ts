/**
 * Integration: the dashboard, served and fetched.
 *
 * A real HTTP server over a real fixture server tree. Every page is requested
 * the way a browser requests it, and what comes back is asserted for the things
 * that matter about this particular interface:
 *
 *   - it renders what was found, with its provenance;
 *   - it says "not collected" where nothing was collected, rather than zero;
 *   - it cannot be made to do anything but read.
 */

import { request as httpRequest } from 'node:http';
import { cp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSilentLogger, loadConfig, resolveConfiguredPath, systemClock } from '@sentinel-forge/core';
import { DashboardContext, startDashboard, type RunningDashboard } from '@sentinel-forge/dashboard';
import { createWorkspace, fixturePath, removeWorkspace, runCli } from '../helpers/workspace.js';

const PAGES = [
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
] as const;

const API = [
  '/api/health',
  '/api/server',
  '/api/resources',
  '/api/dependencies',
  '/api/performance',
  '/api/security',
  '/api/integrity',
  '/api/incidents',
  '/api/reports',
  '/api/settings',
] as const;

describe('dashboard', () => {
  let workspace: string;
  let server: string;
  let running: RunningDashboard;
  let base: string;

  beforeAll(async () => {
    workspace = await createWorkspace('sentinel-dashboard-');
    server = path.join(workspace, 'server');
    await cp(fixturePath('healthy-server'), server, { recursive: true });

    // A collector with telemetry, so the runtime path is exercised rather than
    // only its "not installed" branch.
    const telemetry = path.join(server, 'resources', 'sentinel_doctor', 'telemetry');
    await mkdir(telemetry, { recursive: true });
    await writeFile(
      path.join(telemetry, 'sentinel-telemetry-01.json'),
      JSON.stringify({
        schemaVersion: '1.0',
        collector: 'sentinel_doctor',
        collectorVersion: '0.6.0',
        writtenAt: 1_772_366_400,
        serverUptimeMs: 3_600_000,
        samples: [{ metric: 'scheduler_latency_ms', value: 3, unit: 'ms', playerCount: 21, at: 1_772_366_390 }],
        events: [{ kind: 'resource_started', resource: 'sf_core', detail: 'started', at: 1_772_366_395 }],
        dropped: { samples: 0, events: 0 },
      }),
      'utf8',
    );

    await runCli(['init', '--server', server], workspace);
    await runCli(['scan'], workspace);
    await runCli(['runtime', 'import'], workspace);
    await runCli(['baseline', 'create', 'first'], workspace);
    await runCli(['integrity', 'snapshot', 'first'], workspace);

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

  async function get(pathname: string, init?: RequestInit): Promise<Response> {
    return fetch(`${base}${pathname}`, init);
  }

  /**
   * Sends a request without a client library in the way.
   *
   * `fetch` will not let a caller set `Host` and normalises a path before
   * sending it, so the two properties that matter most here — the Host check
   * and the raw request target — cannot be tested through it.
   */
  function raw(
    target: string,
    headers: Record<string, string> = {},
  ): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const call = httpRequest(
        { host: '127.0.0.1', port: running.port, path: target, method: 'GET', headers },
        (response) => {
          let body = '';
          response.setEncoding('utf8');
          response.on('data', (chunk: string) => (body += chunk));
          response.on('end', () => {
            resolve({ status: response.statusCode ?? 0, body });
          });
        },
      );
      call.on('error', reject);
      call.end();
    });
  }

  it('serves every page', async () => {
    for (const page of PAGES) {
      const response = await get(page);
      expect(response.status, page).toBe(200);
      expect(response.headers.get('content-type'), page).toContain('text/html');
      const body = await response.text();
      expect(body.startsWith('<!doctype html>'), page).toBe(true);
      expect(body, page).toContain('Sentinel Forge');
    }
  });

  it('serves every API endpoint as JSON', async () => {
    for (const endpoint of API) {
      const response = await get(endpoint);
      expect(response.status, endpoint).toBe(200);
      expect(response.headers.get('content-type'), endpoint).toContain('application/json');
      await expect(response.json(), endpoint).resolves.toBeTypeOf('object');
    }
  });

  it('serves a resource detail page and its API equivalent', async () => {
    const page = await get('/resources/sf_core');
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('sf_core');

    const api = await get('/api/resources/sf_core');
    expect(api.status).toBe(200);
    const payload = (await api.json()) as { resource: { resource: { name: string } } };
    expect(payload.resource.resource.name).toBe('sf_core');
  });

  it('reports a resource that does not exist as not found, not as empty', async () => {
    const page = await get('/resources/sf_not_here');
    expect(page.status).toBe(404);
    expect(await page.text()).toContain('No resource named');

    const api = await get('/api/resources/sf_not_here');
    expect(api.status).toBe(404);
  });

  it('states when the data was produced on every page that shows a scan', async () => {
    // A dashboard that renders a cached scan as though it were live is telling
    // the operator something untrue, and they will act on it.
    for (const page of ['/', '/server', '/resources', '/performance']) {
      const body = await (await get(page)).text();
      expect(body, page).toContain('Scan as of');
    }
  });

  it('labels database-derived pages as coming from the local database', async () => {
    for (const page of ['/integrity', '/incidents']) {
      const body = await (await get(page)).text();
      expect(body, page).toContain('Local database as of');
    }
  });

  it('renders every report format from the current scan', async () => {
    const html = await get('/reports/current.html');
    expect(html.status).toBe(200);
    expect(await html.text()).toContain('<!doctype html>');

    const json = await get('/reports/current.json');
    expect(json.status).toBe(200);
    const report = (await json.json()) as { schemaVersion: string; findings: unknown[] };
    expect(report.schemaVersion).toBeTypeOf('string');

    const markdown = await get('/reports/current.md');
    expect(markdown.headers.get('content-type')).toContain('text/markdown');
    expect(await markdown.text()).toContain('# Sentinel Forge report');
  });

  it('shows measured runtime data and names what cannot be measured', async () => {
    const body = await (await get('/performance')).text();
    expect(body).toContain('scheduler_latency_ms');
    // The standing limitation appears on the page, not only in a manual.
    expect(body).toContain('no per-resource timing is collected or reported');
  });

  it('shows recorded history alongside the scan', async () => {
    const performance = await (await get('/performance')).text();
    expect(performance).toContain('first');

    const integrity = await (await get('/integrity')).text();
    expect(integrity).toContain('first');
  });

  it('carries every security header on every response', async () => {
    for (const target of ['/', '/api/health', '/reports/current.html', '/nope']) {
      const response = await get(target);
      expect(response.headers.get('content-security-policy'), target).toContain("default-src 'none'");
      expect(response.headers.get('x-content-type-options'), target).toBe('nosniff');
      expect(response.headers.get('x-frame-options'), target).toBe('DENY');
      expect(response.headers.get('referrer-policy'), target).toBe('no-referrer');
      expect(response.headers.get('cache-control'), target).toBe('no-store');
      expect(response.headers.get('access-control-allow-origin'), target).toBeNull();
    }
  });

  it('emits no script and no external reference on any page', async () => {
    for (const page of PAGES) {
      const body = await (await get(page)).text();
      expect(body, page).not.toMatch(/<script/i);
      expect(body, page).not.toMatch(/\son[a-z]+\s*=/i);
      expect(body, page).not.toMatch(/src="https?:/i);
      expect(body, page).not.toMatch(/<link[^>]+href=/i);
    }
  });

  it('refuses any method that is not GET or HEAD', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const response = await get('/', { method });
      expect(response.status, method).toBe(405);
      expect(response.headers.get('allow'), method).toBe('GET, HEAD');
    }
  });

  it('answers HEAD with the headers and no body', async () => {
    const response = await get('/', { method: 'HEAD' });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
    expect(response.headers.get('content-length')).not.toBe('0');
  });

  it('refuses a request addressed to a hostname that is not ours', async () => {
    // The DNS-rebinding case: a page on evil.example whose DNS answer points
    // at 127.0.0.1 would otherwise be able to read every page here.
    const rebound = await raw('/', { Host: 'evil.example' });
    expect(rebound.status).toBe(421);
    expect(rebound.body).not.toContain('<!doctype html>');

    const expected = await raw('/', { Host: `127.0.0.1:${String(running.port)}` });
    expect(expected.status).toBe(200);
  });

  it('refuses a traversal attempt rather than reading a file', async () => {
    // Sent raw, so the client cannot normalise the attempt away before the
    // server sees it — normalisation by the client would make this vacuous.
    for (const target of [
      '/resources/%2e%2e%2f%2e%2e%2fetc%2fpasswd',
      '/%2e%2e/%2e%2e/etc/passwd',
      '/../../etc/passwd',
      '/resources/%00',
      '/resources/..%2f..%2fetc%2fpasswd',
    ]) {
      const response = await raw(target, { Host: `127.0.0.1:${String(running.port)}` });
      expect([400, 404], `${target} returned ${String(response.status)}`).toContain(response.status);
      expect(response.body, target).not.toContain('root:');
      expect(response.body, target).not.toContain('/bin/');
    }
  });

  it('returns 404 for an unknown page and an unknown endpoint', async () => {
    expect((await get('/nope')).status).toBe(404);
    expect((await get('/api/nope')).status).toBe(404);
    expect((await get('/reports/current.pdf')).status).toBe(404);
  });

  it('refuses to bind an address reachable from the network without an opt-in', async () => {
    const loaded = await loadConfig({ cwd: workspace });
    const context = new DashboardContext({
      loaded,
      serverPath: server,
      databasePath: resolveConfiguredPath(loaded, loaded.config.database.path),
      clock: systemClock,
      logger: createSilentLogger(),
      refreshIntervalMs: 0,
      boundTo: '0.0.0.0:0',
    });

    await expect(
      startDashboard({ context, host: '0.0.0.0', port: 0, logger: createSilentLogger() }),
    ).rejects.toThrow(/reachable from outside this machine/);
  });
});
