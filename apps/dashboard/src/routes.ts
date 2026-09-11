/**
 * Routing.
 *
 * The route table is a fixed list. There is no wildcard that maps a URL onto a
 * filesystem path, and no route serves a file: every response is rendered from
 * data this process already holds. That is why the dashboard has no path
 * traversal surface to defend — there is no path.
 *
 * Two families of route:
 *
 *   - **Pages**, rendered server-side to HTML.
 *   - **`/api/*`**, returning the same data as JSON, so the dashboard is not a
 *     privileged consumer of its own product. Anything a page shows can be
 *     fetched, scripted and diffed.
 *
 * © 2026 Talal Al Ghafri. All Rights Reserved.
 */

import { renderHtmlReport, renderJsonReport, renderMarkdownReport } from '@sentinel-forge/reports';
import type { DashboardContext } from './context.js';
import { redactParsedConfig } from './redact.js';
import { renderErrorPage, renderPage } from './views/layout.js';
import {
  dependenciesPage,
  incidentsPage,
  integrityPage,
  overviewPage,
  performancePage,
  reportsPage,
  resourceDetailPage,
  resourcesPage,
  securityPage,
  serverPage,
  settingsPage,
} from './views/pages.js';

export interface RouteResponse {
  readonly status: number;
  readonly contentType: string;
  readonly body: string;
  readonly headers?: Readonly<Record<string, string>>;
}

const HTML = 'text/html; charset=utf-8';
const JSON_TYPE = 'application/json; charset=utf-8';
const MARKDOWN = 'text/markdown; charset=utf-8';

function html(body: string, status = 200): RouteResponse {
  return { status, contentType: HTML, body };
}

function json(payload: unknown, status = 200): RouteResponse {
  return { status, contentType: JSON_TYPE, body: `${JSON.stringify(payload, null, 2)}\n` };
}

/**
 * Splits a request target into its path and nothing else.
 *
 * The query string is discarded: no route reads one. A dashboard that changes
 * what it shows based on a query parameter would need every parameter
 * validated, and there is nothing here that needs the flexibility.
 */
export function parsePath(target: string): string[] | undefined {
  const withoutQuery = target.split('?')[0]?.split('#')[0] ?? '/';

  let decoded: string;
  try {
    // Percent-encoding is decoded once, deliberately: a resource name can
    // contain characters that must be encoded in a URL, and decoding twice is
    // how traversal sequences get smuggled past a check.
    decoded = decodeURIComponent(withoutQuery);
  } catch {
    return undefined;
  }

  // A NUL or a control character in a path is never legitimate here.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(decoded)) return undefined;

  const segments = decoded.split('/').filter((segment) => segment.length > 0);
  // `.` and `..` have no meaning in this route table, and a request containing
  // one is refused rather than normalised — normalising is where the bugs are.
  if (segments.some((segment) => segment === '.' || segment === '..')) return undefined;

  return segments;
}

export async function handleRequest(target: string, context: DashboardContext): Promise<RouteResponse> {
  const segments = parsePath(target);

  if (segments === undefined) {
    return html(renderErrorPage(400, 'Bad request', 'That address could not be read as a dashboard path.'), 400);
  }

  const path = `/${segments.join('/')}`;
  const isApi = segments[0] === 'api';

  const route = isApi ? segments.slice(1) : segments;
  const head = route[0] ?? '';

  // No route takes more than two segments. An extra one is a mistake or a
  // probe, and answering it with the two-segment page would tell the caller
  // that `/resources/sf_shop/config.lua` is a valid address here.
  if (route.length > 2) {
    return isApi
      ? json({ error: 'No such endpoint.', path }, 404)
      : html(renderErrorPage(404, 'Page not found', `The dashboard has no page at "${path}".`), 404);
  }

  // The scan is needed by almost every route; loading it once here keeps the
  // cache logic in one place and out of each handler.
  const needsScan = !(head === 'integrity' || head === 'incidents');
  const scan = needsScan ? (await context.scan()).result : undefined;
  const scannedAt = context.scannedAt?.toISOString();

  const page = (title: string, body: string, subtitle?: string, source = 'Scan'): RouteResponse =>
    html(
      renderPage({
        title,
        path,
        body,
        ...(subtitle === undefined ? {} : { subtitle }),
        ...(scannedAt === undefined ? {} : { dataAsOf: scannedAt, dataSource: source }),
      }),
    );

  switch (head) {
    case '': {
      const history = context.history();
      if (scan === undefined) break;
      return isApi
        ? json({ health: scan.report.health ?? null, server: scan.report.server, scannedAt })
        : page('Overview', overviewPage(scan, history));
    }

    case 'health': {
      if (!isApi || scan === undefined) break;
      // `health` is an API-only route: the page equivalent is the overview.
      return json({ health: scan.report.health ?? null, scannedAt });
    }

    case 'server': {
      if (scan === undefined) break;
      return isApi
        ? json({
            server: scan.report.server,
            // Redacted for the same reason the page is: a JSON endpoint is the
            // easier of the two surfaces to scrape.
            config: scan.config === undefined ? null : redactParsedConfig(scan.config),
            limitations: scan.report.limitations,
          })
        : page('Server', serverPage(scan));
    }

    case 'resources': {
      if (scan === undefined) break;
      const name = route[1];

      if (name === undefined) {
        return isApi ? json({ resources: scan.report.resources }) : page('Resources', resourcesPage(scan));
      }

      if (isApi) {
        const entry = scan.report.resources.find((candidate) => candidate.resource.name === name);
        if (entry === undefined) return json({ error: 'No such resource in the current scan.', resource: name }, 404);
        return json({
          resource: entry,
          findings: scan.report.findings.filter((finding) => finding.resource === name),
        });
      }

      const body = resourceDetailPage(scan, name);
      if (body === undefined) {
        return html(
          renderErrorPage(
            404,
            'Resource not found',
            `No resource named "${name}" was discovered in the current scan of this server.`,
          ),
          404,
        );
      }
      return page(name, body, 'Resource detail');
    }

    case 'dependencies': {
      if (scan === undefined) break;
      return isApi
        ? json({ dependencies: scan.report.dependencies ?? null })
        : page('Dependencies', dependenciesPage(scan));
    }

    case 'performance': {
      if (scan === undefined) break;
      const history = context.history();
      return isApi
        ? json({
            performance: scan.report.performance ?? null,
            baselines: history.baselines,
            runtime: history.runtime ?? null,
          })
        : page('Performance', performancePage(scan, history));
    }

    case 'security': {
      if (scan === undefined) break;
      return isApi
        ? json({
            security: scan.report.security ?? null,
            findings: scan.report.findings.filter((finding) => finding.category === 'SECURITY'),
          })
        : page('Security', securityPage(scan));
    }

    case 'integrity': {
      const history = context.history();
      return isApi
        ? json({ snapshots: history.snapshots, unavailable: history.unavailableReason ?? null })
        : page('Integrity', integrityPage(history), undefined, 'Local database');
    }

    case 'incidents': {
      const history = context.history();
      return isApi
        ? json({
            incidents: history.incidents,
            runtimeEvents: history.runtimeEvents,
            unavailable: history.unavailableReason ?? null,
          })
        : page('Incidents', incidentsPage(history), undefined, 'Local database');
    }

    case 'reports': {
      if (scan === undefined) break;
      const format = route[1];

      if (format === undefined) {
        return isApi ? json({ report: scan.report }) : page('Reports', reportsPage(scan));
      }
      if (isApi) break;

      switch (format) {
        case 'current.html':
          return html(renderHtmlReport(scan.report));
        case 'current.json':
          return { status: 200, contentType: JSON_TYPE, body: renderJsonReport(scan.report) };
        case 'current.md':
          return { status: 200, contentType: MARKDOWN, body: renderMarkdownReport(scan.report) };
        default:
          break;
      }
      break;
    }

    case 'settings': {
      if (scan === undefined) break;
      const view = {
        serverPath: context.serverPath,
        databasePath: context.databasePath,
        ...(context.config.sourcePath === null ? {} : { configPath: context.config.sourcePath }),
        boundTo: context.boundTo,
        refreshIntervalMs: context.refreshIntervalMs,
        ...(scannedAt === undefined ? {} : { scannedAt }),
      };
      return isApi ? json({ settings: view }) : page('Settings', settingsPage(view, scan));
    }

    default:
      break;
  }

  if (isApi) {
    return json({ error: 'No such endpoint.', path }, 404);
  }

  return html(
    renderErrorPage(404, 'Page not found', `The dashboard has no page at "${path}".`),
    404,
  );
}
