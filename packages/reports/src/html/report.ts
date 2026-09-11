/**
 * HTML report rendering.
 *
 * One self-contained file: the stylesheet is embedded, there is no script, no
 * font request and no image. A report is something an operator emails to a
 * colleague or attaches to a ticket, and one that renders as unstyled markup on
 * a machine without network access would be a worse artifact than plain text.
 *
 * No script at all is emitted. A report is a document; giving it behaviour
 * would mean rendering third-party strings into a JavaScript context, and there
 * is nothing a report needs to do that is worth that.
 *
 * Sections the run did not produce say so, rather than being omitted or shown
 * empty — the difference between "measured, found nothing" and "not measured"
 * is the product's central claim, and a renderer that blurs it is broken.
 *
 * © 2026 Talal Al Ghafri. All Rights Reserved.
 */

import {
  compareFindings,
  countBySeverity,
  INDEPENDENCE_NOTICE,
  PRODUCT_COPYRIGHT,
  PRODUCT_NAME,
  SEVERITIES,
  type SentinelReport,
} from '@sentinel-forge/shared';
import { escapeHtml } from './escape.js';
import {
  card,
  facts,
  findingCard,
  limitations,
  notCollected,
  raw,
  severityBadge,
  table,
  unavailable,
} from './components.js';
import { STYLESHEET } from './theme.js';

function healthSection(report: SentinelReport): string {
  if (report.health === undefined) {
    return `<h2>Health</h2><p>${notCollected('health scoring did not run for this command')}</p>`;
  }

  const health = report.health;
  const parts = [
    '<h2>Health</h2>',
    '<div class="grid">',
    card('Score', `${String(health.score)}/100`, health.complete ? undefined : 'Incomplete — see unavailable categories'),
    ...health.categories.map((category) =>
      card(
        category.category,
        `${String(category.score)}/100`,
        `${String(category.deductions.length)} deduction(s)`,
      ),
    ),
    '</div>',
  ];

  if (health.cap !== undefined) {
    // A cap is always shown with the score it produced: a reader seeing 75/100
    // is entitled to know whether that is a sum of deductions or a ceiling.
    parts.push(
      '<h3>Cap applied</h3>',
      facts([
        ['Score capped to', `${String(health.cap.appliedScore)}/100`],
        ['Because', health.cap.reason],
        ['Rule', health.cap.ruleId],
      ]),
    );
  }

  if (health.primaryReasons.length > 0) {
    parts.push(
      '<h3>Primary reasons</h3>',
      table(
        [{ label: 'Reason' }],
        health.primaryReasons.map((reason) => [reason] as const),
        'No reason was recorded.',
      ),
    );
  }

  for (const category of health.categories) {
    if (category.deductions.length === 0) continue;
    parts.push(
      `<h3>${escapeHtml(category.category)} deductions</h3>`,
      table(
        [{ label: 'Rule' }, { label: 'Severity' }, { label: 'Points', numeric: true }, { label: 'Reason' }],
        category.deductions.map(
          (deduction) =>
            [deduction.ruleId, raw(severityBadge(deduction.severity)), deduction.points, deduction.reason] as const,
        ),
        'No deductions.',
      ),
    );
  }

  const unavailableEntries = Object.entries(health.unavailable ?? {});
  if (unavailableEntries.length > 0) {
    parts.push(
      '<h3>Not scored</h3>',
      table(
        [{ label: 'Category' }, { label: 'Why' }],
        unavailableEntries.map(([category, reason]) => [category, reason] as const),
        'Every category was scored.',
      ),
    );
  }

  return parts.join('');
}

function findingsSection(report: SentinelReport): string {
  const findings = [...report.findings].sort(compareFindings);
  const counts = countBySeverity(findings);

  const parts = [
    '<h2>Findings</h2>',
    table(
      [{ label: 'Severity' }, { label: 'Count', numeric: true }],
      [...SEVERITIES]
        .reverse()
        .map((severity) => [raw(severityBadge(severity)), counts[severity]] as const),
      'No findings.',
    ),
  ];

  if (findings.length === 0) {
    parts.push('<p class="empty">No findings were reported at or above the configured minimum severity.</p>');
    return parts.join('');
  }

  for (const severity of [...SEVERITIES].reverse()) {
    const group = findings.filter((finding) => finding.severity === severity);
    if (group.length === 0) continue;
    parts.push(`<h3>${escapeHtml(severity)} (${String(group.length)})</h3>`);
    for (const finding of group) parts.push(findingCard(finding));
  }

  return parts.join('');
}

function resourcesSection(report: SentinelReport): string {
  const rows = [...report.resources]
    .sort((a, b) => a.resource.name.localeCompare(b.resource.name))
    .map(
      (entry) =>
        [
          entry.resource.name,
          // A version is shown only when the manifest declared one. It is never
          // inferred from a directory name.
          entry.resource.version ?? raw(unavailable('no version declared')),
          entry.resource.manifestKind,
          entry.resource.fileCount,
          entry.resource.declaredDependencies.length,
          entry.findingIds.length,
        ] as const,
    );

  return [
    '<h2>Resources</h2>',
    table(
      [
        { label: 'Resource' },
        { label: 'Version' },
        { label: 'Manifest' },
        { label: 'Files', numeric: true },
        { label: 'Dependencies', numeric: true },
        { label: 'Findings', numeric: true },
      ],
      rows,
      'No resources were discovered.',
    ),
  ].join('');
}

function dependenciesSection(report: SentinelReport): string {
  if (report.dependencies === undefined) {
    return `<h2>Dependencies</h2><p>${notCollected('dependency analysis did not run for this command')}</p>`;
  }

  const { edges, unresolved, cycles } = report.dependencies;
  const parts = [
    '<h2>Dependencies</h2>',
    '<div class="grid">',
    card('Edges', edges.length),
    card('Unresolved', unresolved.length),
    card('Cycles', cycles.length),
    '</div>',
  ];

  if (unresolved.length > 0) {
    parts.push(
      '<h3>Unresolved</h3>',
      table(
        [{ label: 'From' }, { label: 'To' }, { label: 'Kind' }, { label: 'Declared in' }],
        unresolved.map((edge) => [edge.from, edge.to, edge.kind, edge.declaredIn ?? ''] as const),
        'Every edge resolved.',
      ),
    );
  }

  if (cycles.length > 0) {
    parts.push(
      '<h3>Cycles</h3>',
      table(
        [{ label: 'Cycle' }],
        cycles.map((cycle) => [[...cycle, cycle[0] ?? ''].join(' → ')] as const),
        'No cycle was found.',
      ),
    );
  }

  return parts.join('');
}

function performanceSection(report: SentinelReport): string {
  const performance = report.performance;
  if (performance === undefined) {
    return `<h2>Performance</h2><p>${notCollected('performance analysis did not run for this command')}</p>`;
  }

  const parts = ['<h2>Performance</h2>'];
  const runtime = performance.runtime;

  if (runtime === undefined) {
    parts.push(
      `<p>${notCollected(
        'the sentinel_doctor collector is not installed on this server, so nothing about the running server was measured',
      )}</p>`,
    );
    return parts.join('');
  }

  parts.push(
    '<div class="grid">',
    card('Measured samples', runtime.sampleCount, runtime.sampleCount === 0 ? 'collector installed, nothing measured yet' : undefined),
    card('Observed events', runtime.eventCount),
    card('Telemetry documents', runtime.documentCount),
    '</div>',
    facts([
      ['Metrics', runtime.metrics.length === 0 ? undefined : runtime.metrics.join(', ')],
      ['Earliest measurement', runtime.earliest],
      ['Latest measurement', runtime.latest],
      [
        'Dropped by the collector',
        runtime.dropped.samples + runtime.dropped.events === 0
          ? 'none'
          : `${String(runtime.dropped.samples)} sample(s), ${String(runtime.dropped.events)} event(s) — buffer was full`,
      ],
    ]),
  );

  if (runtime.unreadable.length > 0) {
    parts.push(
      '<h3>Telemetry that could not be read</h3>',
      table(
        [{ label: 'File' }, { label: 'Reason' }],
        runtime.unreadable.map((entry) => [entry.file, entry.reason] as const),
        'Every telemetry file was readable.',
      ),
    );
  }

  return parts.join('');
}

function securitySection(report: SentinelReport): string {
  if (report.security === undefined) {
    return `<h2>Security</h2><p>${notCollected('security analysis did not run for this command')}</p>`;
  }

  const security = report.security;
  return [
    '<h2>Security</h2>',
    table(
      [{ label: 'Severity' }, { label: 'Count', numeric: true }],
      [...SEVERITIES]
        .reverse()
        .map((severity) => [raw(severityBadge(severity)), security.bySeverity[severity] ?? 0] as const),
      'No security indicators.',
    ),
    `<p class="note">${escapeHtml(security.limitation)}</p>`,
  ].join('');
}

function integritySection(report: SentinelReport): string {
  if (report.integrity === undefined) {
    return `<h2>Integrity</h2><p>${notCollected('integrity comparison requires two snapshots')}</p>`;
  }

  const integrity = report.integrity;
  return [
    '<h2>Integrity</h2>',
    '<div class="grid">',
    card('Added', integrity.added.length),
    card('Modified', integrity.modified.length),
    card('Deleted', integrity.deleted.length),
    '</div>',
  ].join('');
}

function incidentsSection(report: SentinelReport): string {
  return [
    '<h2>Incidents</h2>',
    table(
      [
        { label: 'Severity' },
        { label: 'Started' },
        { label: 'Confidence', numeric: true },
        { label: 'Summary' },
        { label: 'Resources' },
      ],
      report.incidents.map(
        (incident) =>
          [
            raw(severityBadge(incident.severity)),
            incident.startTime,
            incident.confidence.toFixed(2),
            incident.summary,
            incident.affectedResources.join(', '),
          ] as const,
      ),
      'No incidents were correlated for this report.',
    ),
    '<p class="note">Correlation states that observations are related in time. It never states that one caused the other.</p>',
  ].join('');
}

/**
 * Renders a complete, self-contained HTML report.
 *
 * @param report - The report to render. Secrets are redacted before a finding
 *   reaches this package; nothing here reintroduces a raw value.
 */
export function renderHtmlReport(report: SentinelReport): string {
  const title = `${PRODUCT_NAME} report — ${report.server.path}`;

  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    // A report is a local file. It must never be able to reach the network,
    // whatever a scanned resource managed to get into a string.
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:">',
    `<title>${escapeHtml(title)}</title>`,
    `<style>${STYLESHEET}</style>`,
    '</head>',
    '<body>',
    '<div class="main">',
    `<h1>${escapeHtml(PRODUCT_NAME)} report</h1>`,
    `<p class="subtitle">Generated ${escapeHtml(report.generatedAt)} by ${escapeHtml(
      PRODUCT_NAME,
    )} ${escapeHtml(report.metadata.productVersion)} (<code>${escapeHtml(report.metadata.command)}</code>), report schema ${escapeHtml(report.schemaVersion)}.</p>`,

    '<h2>Server</h2>',
    facts([
      ['Path', report.server.path],
      ['Configuration', report.server.configPath],
      ['Resource roots', report.server.resourceRoots.join(', ')],
      ['Resources', report.server.resourceCount],
      ['Fingerprint', report.server.fingerprint.slice(0, 16)],
      ['Scanned at', report.server.scannedAt],
      ['Scan duration', `${String(report.metadata.durationMs)} ms`],
      ['Host', `${report.metadata.hostPlatform}, Node ${report.metadata.nodeVersion}`],
    ]),

    healthSection(report),
    findingsSection(report),
    resourcesSection(report),
    dependenciesSection(report),
    performanceSection(report),
    securitySection(report),
    integritySection(report),
    incidentsSection(report),
    limitations(report.limitations),

    '<footer class="page">',
    `<p>${escapeHtml(INDEPENDENCE_NOTICE)}</p>`,
    `<p>${escapeHtml(PRODUCT_COPYRIGHT)}</p>`,
    '</footer>',
    '</div>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}
