/**
 * The page shell.
 *
 * Every page is rendered through here, so three things are impossible to forget
 * on an individual page: the navigation, the provenance line saying when the
 * data was produced, and the independence notice.
 *
 * The shell emits no `<script>` and no external reference. The dashboard is a
 * server-rendered document; giving it client-side behaviour would mean placing
 * third-party strings — resource names, file paths, Lua excerpts — into a
 * JavaScript context, and nothing the dashboard needs to do is worth that.
 *
 * © 2026 Talal Al Ghafri. All Rights Reserved.
 */

import { escapeHtml, STYLESHEET } from '@sentinel-forge/reports';
import { INDEPENDENCE_NOTICE, PRODUCT_COPYRIGHT, PRODUCT_NAME, PRODUCT_SUBTITLE, PRODUCT_VERSION } from '@sentinel-forge/shared';

export interface NavigationEntry {
  readonly href: string;
  readonly label: string;
}

/**
 * The navigation, in the order an investigation actually runs: overview first,
 * then the server and its resources, then the evidence, then the records.
 */
export const NAVIGATION: readonly NavigationEntry[] = Object.freeze([
  { href: '/', label: 'Overview' },
  { href: '/server', label: 'Server' },
  { href: '/resources', label: 'Resources' },
  { href: '/dependencies', label: 'Dependencies' },
  { href: '/performance', label: 'Performance' },
  { href: '/security', label: 'Security' },
  { href: '/integrity', label: 'Integrity' },
  { href: '/incidents', label: 'Incidents' },
  { href: '/reports', label: 'Reports' },
  { href: '/settings', label: 'Settings' },
]);

export interface PageOptions {
  readonly title: string;
  /** One line under the heading. Usually says what the page is showing. */
  readonly subtitle?: string;
  /** Path of the current page, for marking the navigation entry. */
  readonly path: string;
  /** Pre-escaped HTML body. */
  readonly body: string;
  /** When the displayed data was produced, when the page shows scan data. */
  readonly dataAsOf?: string;
  /** How the displayed data was produced, e.g. "scan" or "local database". */
  readonly dataSource?: string;
}

function navigation(current: string): string {
  return NAVIGATION.map((entry) => {
    // `/resources/sf_core` marks `/resources`; `/` matches only itself.
    const isCurrent = entry.href === '/' ? current === '/' : current === entry.href || current.startsWith(`${entry.href}/`);
    return `<a href="${escapeHtml(entry.href)}"${isCurrent ? ' aria-current="page"' : ''}>${escapeHtml(entry.label)}</a>`;
  }).join('');
}

export function renderPage(options: PageOptions): string {
  const provenance =
    options.dataAsOf === undefined
      ? ''
      : `<p class="subtitle">${escapeHtml(options.dataSource ?? 'Data')} as of ${escapeHtml(options.dataAsOf)}</p>`;

  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    // Defence in depth: the server sends this as a header too, and a page saved
    // to disk keeps the same restrictions. `frame-ancestors` is deliberately
    // absent here — a browser ignores it in a meta element and warns about it,
    // and it is enforced by the response header, where it works.
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:; form-action \'none\'; base-uri \'none\'">',
    '<meta name="referrer" content="no-referrer">',
    `<title>${escapeHtml(options.title)} — ${escapeHtml(PRODUCT_NAME)}</title>`,
    `<style>${STYLESHEET}</style>`,
    '</head>',
    '<body>',
    '<div class="layout">',
    '<nav class="sidebar">',
    '<div class="brand">',
    `<strong>${escapeHtml(PRODUCT_NAME)}</strong>`,
    `<span>${escapeHtml(PRODUCT_SUBTITLE)} · ${escapeHtml(PRODUCT_VERSION)}</span>`,
    '</div>',
    `<div class="nav">${navigation(options.path)}</div>`,
    '</nav>',
    '<main class="main">',
    `<h1>${escapeHtml(options.title)}</h1>`,
    options.subtitle === undefined ? '' : `<p class="subtitle">${escapeHtml(options.subtitle)}</p>`,
    provenance,
    options.body,
    '<footer class="page">',
    '<p>Read-only. Sentinel Forge never modifies the server it analyses, and this interface cannot run a command against it.</p>',
    `<p>${escapeHtml(INDEPENDENCE_NOTICE)}</p>`,
    `<p>${escapeHtml(PRODUCT_COPYRIGHT)}</p>`,
    '</footer>',
    '</main>',
    '</div>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

/** An error page. Uses the same shell, so a failure still says what the product is. */
export function renderErrorPage(status: number, title: string, detail: string): string {
  return renderPage({
    title,
    path: '',
    body: [
      `<p class="empty">${escapeHtml(detail)}</p>`,
      '<p><a href="/">Back to the overview</a></p>',
    ].join(''),
    subtitle: `HTTP ${String(status)}`,
  });
}
