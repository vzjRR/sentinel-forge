/**
 * The dashboard's pages.
 *
 * Each function turns already-gathered data into a page body. They do no I/O
 * and take no request object, which keeps them testable as pure string
 * functions and keeps the decision of *what to load* in one place.
 *
 * The rule every page here holds to: a value that was not measured is rendered
 * as "Unavailable" or "Not collected", with the reason, in the place the value
 * would have gone. It is never rendered as zero, as a dash, or as an empty
 * table that reads like a clean result.
 *
 * © 2026 Talal Al Ghafri. All Rights Reserved.
 */

import {
  card,
  escapeHtml,
  facts,
  findingCard,
  limitations,
  link,
  notCollected,
  raw,
  severityBadge,
  table,
  unavailable,
  type Cell,
} from '@sentinel-forge/reports';
import { displayConfigValue } from '../redact.js';
import {
  compareFindings,
  countBySeverity,
  RUNTIME_SECTION_LIMITATION,
  SECURITY_SECTION_LIMITATION,
  SEVERITIES,
  type Finding,
  type SentinelReport,
  type Severity,
} from '@sentinel-forge/shared';
import type { ScanResult } from '@sentinel-forge/engine';
import type { StoredHistory } from '../context.js';

/** Link to a resource page, with the name encoded for a path segment. */
export function resourceHref(resource: string): string {
  return `/resources/${encodeURIComponent(resource)}`;
}

function severityCounts(findings: readonly Finding[]): string {
  const counts = countBySeverity(findings);
  return table(
    [{ label: 'Severity' }, { label: 'Count', numeric: true }],
    [...SEVERITIES].reverse().map((severity) => [raw(severityBadge(severity)), counts[severity]] as const),
    'No findings.',
  );
}

function findingList(findings: readonly Finding[], empty: string): string {
  if (findings.length === 0) return `<p class="empty">${escapeHtml(empty)}</p>`;
  return [...findings]
    .sort(compareFindings)
    .map((finding) => findingCard(finding, { resourceHref }))
    .join('');
}

function healthCard(report: SentinelReport): string {
  if (report.health === undefined) return card('Health', raw(notCollected('health scoring did not run')));
  return card(
    'Health',
    `${String(report.health.score)}/100`,
    report.health.complete ? undefined : 'Incomplete — some categories were not scored',
  );
}

/* -------------------------------------------------------------------------- */
/* Overview                                                                    */
/* -------------------------------------------------------------------------- */

export function overviewPage(scan: ScanResult, history: StoredHistory): string {
  const report = scan.report;
  const findings = [...report.findings].sort(compareFindings);
  const runtime = report.performance?.runtime;

  const parts = [
    '<div class="grid">',
    healthCard(report),
    card('Resources', report.server.resourceCount),
    card('Findings', findings.length),
    card('Unresolved dependencies', scan.graph.unresolved.length),
    card('Dependency cycles', scan.graph.cycles.length),
    runtime === undefined
      ? card('Runtime samples', raw(notCollected('collector not installed')))
      : card('Runtime samples', runtime.sampleCount, runtime.sampleCount === 0 ? 'collector installed, nothing measured yet' : undefined),
    '</div>',

    '<h2>Findings by severity</h2>',
    severityCounts(findings),
  ];

  const topFindings = findings.slice(0, 5);
  parts.push(
    '<h2>Most severe findings</h2>',
    findingList(topFindings, 'No findings were reported at or above the configured minimum severity.'),
  );
  if (findings.length > topFindings.length) {
    parts.push(
      `<p><a href="/resources">${escapeHtml(
        `${String(findings.length - topFindings.length)} more finding(s) — see the resource pages`,
      )}</a></p>`,
    );
  }

  parts.push(
    '<h2>Recorded history</h2>',
    history.unavailableReason === undefined
      ? table(
          [{ label: 'Record' }, { label: 'Count', numeric: true }, { label: '' }],
          [
            ['Baselines', history.baselines.length, raw(link('/performance', 'Performance'))] as const,
            ['Incidents', history.incidents.length, raw(link('/incidents', 'Incidents'))] as const,
            ['Integrity snapshots', history.snapshots.length, raw(link('/integrity', 'Integrity'))] as const,
            [
              'Runtime documents imported',
              history.runtime?.documentCount ?? 0,
              raw(link('/performance', 'Performance')),
            ] as const,
          ],
          'Nothing has been recorded yet.',
        )
      : `<p class="empty">${escapeHtml(
          `Recorded history is unavailable: ${history.unavailableReason}`,
        )}</p>`,

    limitations(report.limitations),
  );

  return parts.join('');
}

/* -------------------------------------------------------------------------- */
/* Server                                                                      */
/* -------------------------------------------------------------------------- */

export function serverPage(scan: ScanResult): string {
  const report = scan.report;
  const config = scan.config;

  const parts = [
    '<h2>Identity</h2>',
    facts([
      ['Path', report.server.path],
      ['Configuration file', report.server.configPath],
      ['Resource roots', report.server.resourceRoots.join(', ')],
      ['Resources discovered', report.server.resourceCount],
      ['Files outside a resource', scan.server.looseFileCount],
      ['Fingerprint', report.server.fingerprint.slice(0, 16)],
      ['Scanned at', report.server.scannedAt],
      ['Scan duration', `${String(report.metadata.durationMs)} ms`],
      ['Host', `${report.metadata.hostPlatform}, Node ${report.metadata.nodeVersion}`],
    ]),
  ];

  parts.push('<h2>Health</h2>');
  if (report.health === undefined) {
    parts.push(`<p>${notCollected('health scoring did not run for this command')}</p>`);
  } else {
    const health = report.health;
    parts.push(
      '<div class="grid">',
      card('Overall', `${String(health.score)}/100`),
      ...health.categories.map((category) =>
        card(category.category, `${String(category.score)}/100`, `${String(category.deductions.length)} deduction(s)`),
      ),
      '</div>',
    );

    if (health.cap !== undefined) {
      parts.push(
        '<h3>Cap applied</h3>',
        facts([
          ['Score capped to', `${String(health.cap.appliedScore)}/100`],
          ['Because', health.cap.reason],
          ['Rule', health.cap.ruleId],
        ]),
      );
    }

    for (const category of health.categories) {
      if (category.deductions.length === 0) continue;
      parts.push(
        `<h3>${escapeHtml(category.category)} — every point deducted</h3>`,
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

    const unscored = Object.entries(health.unavailable ?? {});
    if (unscored.length > 0) {
      parts.push(
        '<h3>Not scored</h3>',
        table(
          [{ label: 'Category' }, { label: 'Why' }],
          unscored.map(([category, reason]) => [category, reason] as const),
          'Every category was scored.',
        ),
      );
    }
  }

  parts.push('<h2>Configuration</h2>');
  if (config === undefined) {
    parts.push(`<p>${notCollected('no server configuration file was found or it could not be read')}</p>`);
  } else {
    parts.push(
      '<div class="grid">',
      card('Resource directives', config.resourceDirectives.length),
      card('Variables', config.variables.length),
      card('exec directives', config.execs.length),
      card('Recognised commands', config.commandCount),
      '</div>',
      '<h3>Resource directives</h3>',
      table(
        [{ label: 'Command' }, { label: 'Target' }, { label: 'Category' }, { label: 'Line', numeric: true }],
        config.resourceDirectives.map(
          (directive) =>
            [directive.command, directive.target, directive.isCategory ? 'yes' : 'no', directive.line] as const,
        ),
        'The configuration starts no resource.',
      ),
      '<h3>Variables</h3>',
      table(
        [{ label: 'Command' }, { label: 'Name' }, { label: 'Value' }, { label: 'Line', numeric: true }],
        config.variables.map(
          // Values are withheld before they reach the page. `sv_licenseKey`,
          // database connection strings and Discord tokens all live in
          // server.cfg, and a dashboard that prints one has leaked it to
          // anything that can read the screen or the page source.
          (variable) =>
            [variable.command, variable.name, displayConfigValue(variable.name, variable.value), variable.line] as const,
        ),
        'The configuration sets no variable.',
      ),
      '<p class="note">Configuration values are redacted before display. Sentinel Forge never shows a credential, ' +
        'and never stores one.</p>',
    );
  }

  if (scan.server.limitations.length > 0) {
    parts.push(
      '<h2>Not analyzed</h2>',
      table(
        [{ label: 'Path' }, { label: 'Reason' }],
        scan.server.limitations.map((limitation) => [limitation.path, limitation.reason] as const),
        'Everything under the server root was analyzed.',
      ),
    );
  }

  parts.push(limitations(report.limitations));
  return parts.join('');
}

/* -------------------------------------------------------------------------- */
/* Resources                                                                   */
/* -------------------------------------------------------------------------- */

export function resourcesPage(scan: ScanResult): string {
  const report = scan.report;

  const rows = [...report.resources]
    .sort((a, b) => {
      const difference = b.findingIds.length - a.findingIds.length;
      return difference !== 0 ? difference : a.resource.name.localeCompare(b.resource.name);
    })
    .map((entry): readonly Cell[] => {
      const health = entry.health;
      return [
        raw(link(resourceHref(entry.resource.name), entry.resource.name)),
        entry.resource.version ?? raw(unavailable('no version declared')),
        entry.resource.manifestKind,
        entry.resource.fileCount,
        entry.resource.declaredDependencies.length,
        entry.findingIds.length,
        health === undefined ? raw(unavailable('not scored')) : `${String(health.score)}/100`,
      ];
    });

  return [
    `<p class="subtitle">${escapeHtml(
      'Ordered by finding count. A resource with no findings is not necessarily healthy — it is a resource nothing was found in.',
    )}</p>`,
    table(
      [
        { label: 'Resource' },
        { label: 'Version' },
        { label: 'Manifest' },
        { label: 'Files', numeric: true },
        { label: 'Dependencies', numeric: true },
        { label: 'Findings', numeric: true },
        { label: 'Health' },
      ],
      rows,
      'No resources were discovered under the configured resource directories.',
    ),
    limitations(report.limitations),
  ].join('');
}

export function resourceDetailPage(scan: ScanResult, name: string): string | undefined {
  const entry = scan.report.resources.find((candidate) => candidate.resource.name === name);
  if (entry === undefined) return undefined;

  const discovered = scan.server.resources.find((candidate) => candidate.name === name);
  const findings = scan.report.findings.filter((finding) => finding.resource === name);

  const dependsOn = scan.graph.edges.filter((edge) => edge.from === name);
  const dependedOnBy = scan.graph.edges.filter((edge) => edge.to === name);
  const scripts = scan.scripts.filter((script) => script.resource === name);

  const manifest = discovered?.manifest;

  const parts = [
    '<h2>Identity</h2>',
    facts([
      ['Name', entry.resource.name],
      ['Path', entry.resource.path],
      ['Manifest', entry.resource.manifestKind],
      ['Declared version', entry.resource.version],
      // Declared metadata, shown as written. It is third-party text like any
      // other and is escaped, never interpreted.
      ['Declared author', manifest?.author?.value],
      ['Declared description', manifest?.description?.value],
      ['fx_version', manifest?.fxVersion?.value],
      ['Games declared', manifest === undefined || manifest.games.length === 0 ? undefined : manifest.games.map((game) => game.value).join(', ')],
      ['Files', entry.resource.fileCount],
      ['Category directory', discovered?.category],
      [
        'Health',
        entry.health === undefined ? undefined : `${String(entry.health.score)}/100`,
      ],
    ]),

    '<h2>Findings</h2>',
    severityCounts(findings),
    findingList(findings, 'Nothing was found in this resource. That is not the same as this resource being safe.'),

    '<h2>Dependencies</h2>',
    table(
      [{ label: 'Direction' }, { label: 'Resource' }, { label: 'Kind' }, { label: 'Resolved' }],
      [
        ...dependsOn.map(
          (edge) =>
            [
              'depends on',
              raw(link(resourceHref(edge.to), edge.to)),
              edge.kind,
              edge.resolved ? 'yes' : 'no',
            ] as const,
        ),
        ...dependedOnBy.map(
          (edge) =>
            [
              'depended on by',
              raw(link(resourceHref(edge.from), edge.from)),
              edge.kind,
              edge.resolved ? 'yes' : 'no',
            ] as const,
        ),
      ],
      'This resource neither declares a dependency nor is depended on by another resource that was scanned.',
    ),

    '<h2>Scripts analysed</h2>',
    table(
      [
        { label: 'File' },
        { label: 'Side' },
        { label: 'Loops', numeric: true },
        { label: 'Events', numeric: true },
        { label: 'Queries', numeric: true },
      ],
      scripts.map(
        (script) =>
          [
            script.filePath,
            script.side,
            script.loops.length,
            script.events.length,
            script.queries.length,
          ] as const,
      ),
      'No script in this resource was read for this scan.',
    ),
  ];

  const files = discovered?.files ?? [];
  parts.push(
    '<h2>Files</h2>',
    table(
      [{ label: 'Path' }, { label: 'Bytes', numeric: true }, { label: 'Modified' }, { label: 'Content hash' }],
      files
        .slice(0, 200)
        // The content hash is shown truncated: it is what an integrity
        // comparison keys on, and an operator checking whether a file changed
        // needs to be able to read it without exporting a snapshot.
        .map((file) => [file.path, file.size, file.modifiedAt, file.hash.slice(0, 12)] as const),
      'This resource contains no files.',
    ),
    files.length > 200
      ? `<p class="note">${escapeHtml(`Showing the first 200 of ${String(files.length)} files.`)}</p>`
      : '',
    limitations(scan.report.limitations),
  );

  return parts.join('');
}

/* -------------------------------------------------------------------------- */
/* Dependencies                                                                */
/* -------------------------------------------------------------------------- */

export function dependenciesPage(scan: ScanResult): string {
  const graph = scan.graph;

  return [
    '<div class="grid">',
    card('Edges', graph.edges.length),
    card('Unresolved', graph.unresolved.length),
    card('Cycles', graph.cycles.length),
    '</div>',

    '<h2>Unresolved</h2>',
    table(
      [{ label: 'From' }, { label: 'To' }, { label: 'Kind' }, { label: 'Declared in' }],
      graph.unresolved.map(
        (edge) =>
          [
            raw(link(resourceHref(edge.from), edge.from)),
            edge.to,
            edge.kind,
            edge.declaredIn ?? '',
          ] as const,
      ),
      'Every declared and discovered dependency resolved to a resource that exists.',
    ),

    '<h2>Cycles</h2>',
    table(
      [{ label: 'Cycle' }],
      graph.cycles.map((cycle) => [[...cycle, cycle[0] ?? ''].join(' → ')] as const),
      'No dependency cycle was found.',
    ),

    '<h2>Every edge</h2>',
    table(
      [{ label: 'From' }, { label: 'To' }, { label: 'Kind' }, { label: 'Resolved' }, { label: 'Declared in' }],
      graph.edges.map(
        (edge) =>
          [
            raw(link(resourceHref(edge.from), edge.from)),
            edge.resolved ? raw(link(resourceHref(edge.to), edge.to)) : edge.to,
            edge.kind,
            edge.resolved ? 'yes' : 'no',
            edge.declaredIn ?? '',
          ] as const,
      ),
      'No dependency relationship was found between the scanned resources.',
    ),

    '<p class="note">A <code>/</code>-prefixed entry such as <code>/server:5104</code> is a runtime constraint, ' +
      'not a resource, and is excluded from this graph rather than reported as missing.</p>',

    limitations(scan.report.limitations),
  ].join('');
}

/* -------------------------------------------------------------------------- */
/* Performance                                                                 */
/* -------------------------------------------------------------------------- */

export function performancePage(scan: ScanResult, history: StoredHistory): string {
  const runtime = scan.report.performance?.runtime;
  const staticFindings = scan.report.findings.filter((finding) => finding.category === 'PERFORMANCE');

  const parts = ['<h2>Measured</h2>'];

  if (runtime === undefined) {
    parts.push(
      `<p>${notCollected(
        'the sentinel_doctor collector is not installed on this server, so nothing about the running server has been measured',
      )}</p>`,
      '<p class="note">Install <code>resources/sentinel_doctor</code> into the server, add ' +
        '<code>ensure sentinel_doctor</code> to <code>server.cfg</code>, then run ' +
        '<code>sentinel runtime import</code>.</p>',
    );
  } else {
    parts.push(
      '<div class="grid">',
      card(
        'Samples on disk',
        runtime.sampleCount,
        runtime.sampleCount === 0 ? 'collector installed, nothing measured yet' : undefined,
      ),
      card('Events on disk', runtime.eventCount),
      card('Telemetry documents', runtime.documentCount),
      card('Samples imported', history.runtime?.sampleCount ?? raw(unavailable('history unavailable'))),
      '</div>',
      facts([
        ['Metrics measured', runtime.metrics.length === 0 ? undefined : runtime.metrics.join(', ')],
        ['Earliest measurement', runtime.earliest],
        ['Latest measurement', runtime.latest],
        ['Collector version', history.runtime?.collectorVersions.join(', ')],
        ['Last import', history.runtime?.lastImportedAt],
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
  }

  parts.push(
    '<h2>Baselines</h2>',
    history.unavailableReason !== undefined
      ? `<p class="empty">${escapeHtml(`Recorded history is unavailable: ${history.unavailableReason}`)}</p>`
      : table(
          [
            { label: 'Label' },
            { label: 'Captured' },
            { label: 'Resources', numeric: true },
            { label: 'Findings', numeric: true },
            { label: 'Health' },
            { label: 'Samples', numeric: true },
          ],
          history.baselines.map(
            (baseline) =>
              [
                baseline.label,
                baseline.createdAt,
                baseline.resourceCount,
                baseline.findingCount,
                baseline.healthScore === undefined
                  ? raw(unavailable('not scored'))
                  : `${String(baseline.healthScore)}/100`,
                baseline.sampleCount,
              ] as const,
          ),
          'No baseline has been recorded. Capture one with `sentinel baseline create <label>`.',
        ),

    '<h2>Static performance findings</h2>',
    `<p class="subtitle">${escapeHtml(
      'Produced by reading code, not by measuring the running server. These are separate claims and are never merged.',
    )}</p>`,
    findingList(staticFindings, 'No performance finding was produced by static analysis.'),

    limitations([RUNTIME_SECTION_LIMITATION, ...scan.report.limitations]),
  );

  return parts.join('');
}

/* -------------------------------------------------------------------------- */
/* Security                                                                    */
/* -------------------------------------------------------------------------- */

export function securityPage(scan: ScanResult): string {
  const findings = scan.report.findings.filter((finding) => finding.category === 'SECURITY');

  return [
    `<p class="subtitle">${escapeHtml(
      'Findings here are indicators. They do not establish that code is malicious, and the absence of a finding is not evidence of safety.',
    )}</p>`,
    severityCounts(findings),
    findingList(findings, 'No security indicator was detected.'),
    '<p class="note">Detected credentials are reported by location only. The value is never displayed, logged or stored.</p>',
    limitations([SECURITY_SECTION_LIMITATION, ...scan.report.limitations]),
  ].join('');
}

/* -------------------------------------------------------------------------- */
/* Integrity                                                                   */
/* -------------------------------------------------------------------------- */

export function integrityPage(history: StoredHistory): string {
  if (history.unavailableReason !== undefined) {
    return `<p class="empty">${escapeHtml(`Recorded history is unavailable: ${history.unavailableReason}`)}</p>`;
  }

  return [
    '<h2>Snapshots</h2>',
    table(
      [
        { label: 'Label' },
        { label: 'Captured' },
        { label: 'Files', numeric: true },
        { label: 'Bytes', numeric: true },
        { label: 'Snapshot hash' },
      ],
      history.snapshots.map(
        (snapshot) =>
          [
            snapshot.label ?? raw(unavailable('unlabelled')),
            snapshot.createdAt,
            snapshot.fileCount,
            snapshot.totalBytes,
            snapshot.snapshotHash.slice(0, 16),
          ] as const,
      ),
      'No integrity snapshot has been taken. Take one with `sentinel integrity snapshot <label>`.',
    ),
    '<p class="note">Comparison needs two snapshots. Run <code>sentinel integrity compare &lt;a&gt; &lt;b&gt;</code>. ' +
      'Files are never quarantined, moved, modified or deleted.</p>',
  ].join('');
}

/* -------------------------------------------------------------------------- */
/* Incidents                                                                   */
/* -------------------------------------------------------------------------- */

export function incidentsPage(history: StoredHistory): string {
  if (history.unavailableReason !== undefined) {
    return `<p class="empty">${escapeHtml(`Recorded history is unavailable: ${history.unavailableReason}`)}</p>`;
  }

  return [
    `<p class="subtitle">${escapeHtml(
      'An incident groups observations that happened in the same window. Correlation never establishes causation.',
    )}</p>`,
    table(
      [
        { label: 'Severity' },
        { label: 'Started' },
        { label: 'Confidence', numeric: true },
        { label: 'Summary' },
        { label: 'Resources' },
      ],
      history.incidents.map(
        (incident) =>
          [
            raw(severityBadge(incident.severity as Severity)),
            incident.startedAt,
            incident.confidence.toFixed(2),
            incident.summary,
            incident.affectedResources.length === 0 ? 'server-wide' : incident.affectedResources.join(', '),
          ] as const,
      ),
      'No incident has been correlated. Incidents are produced by `sentinel compare` between two baselines.',
    ),
    '<h2>Runtime events observed</h2>',
    `<p class="subtitle">${escapeHtml(
      'What the collector saw the server do. Observations, not conclusions: why a resource stopped is not visible to a script and is not inferred.',
    )}</p>`,
    table(
      [{ label: 'Observed' }, { label: 'Event' }, { label: 'Resource' }, { label: 'Detail' }, { label: 'Players', numeric: true }],
      history.runtimeEvents.map(
        (event) =>
          [
            event.observedAt,
            event.kind,
            event.resource ?? '(server)',
            event.detail ?? '',
            event.playerCount ?? raw(unavailable('not recorded')),
          ] as const,
      ),
      'No runtime event has been imported.',
    ),
    '<p class="note">Incident confidence is capped at 0.85. An incident never names a cause.</p>',
  ].join('');
}

/* -------------------------------------------------------------------------- */
/* Reports                                                                     */
/* -------------------------------------------------------------------------- */

export function reportsPage(scan: ScanResult): string {
  return [
    `<p class="subtitle">${escapeHtml(
      'The current scan, rendered in each format the product produces. These are the same renderers the CLI uses.',
    )}</p>`,
    table(
      [{ label: 'Format' }, { label: 'Open' }, { label: 'What it is for' }],
      [
        ['HTML', raw(link('/reports/current.html', 'current.html')), 'A self-contained document to attach or print.'] as const,
        ['JSON', raw(link('/reports/current.json', 'current.json')), 'The full report envelope, schema-versioned.'] as const,
        ['Markdown', raw(link('/reports/current.md', 'current.md')), 'For a pull request or a ticket.'] as const,
      ],
      'No report format is available.',
    ),
    '<h2>This report</h2>',
    facts([
      ['Report schema', scan.report.schemaVersion],
      ['Product version', scan.report.metadata.productVersion],
      ['Command', scan.report.metadata.command],
      ['Generated at', scan.report.generatedAt],
      ['Findings', scan.report.findings.length],
      ['Resources', scan.report.resources.length],
    ]),
    '<p class="note">To write a report to a file, use <code>sentinel report --format html</code>. ' +
      'The dashboard is read-only and writes nothing outside the local database.</p>',
  ].join('');
}

/* -------------------------------------------------------------------------- */
/* Settings                                                                    */
/* -------------------------------------------------------------------------- */

export interface SettingsView {
  readonly serverPath: string;
  readonly databasePath: string;
  readonly configPath?: string;
  readonly boundTo: string;
  readonly refreshIntervalMs: number;
  readonly scannedAt?: string;
}

export function settingsPage(view: SettingsView, scan: ScanResult): string {
  const config = scan.report;

  return [
    `<p class="subtitle">${escapeHtml(
      'Read-only. Settings are changed in sentinel.config.json or on the command line; the dashboard cannot change them.',
    )}</p>`,
    '<h2>This session</h2>',
    facts([
      ['Server path', view.serverPath],
      ['Configuration file', view.configPath],
      ['Local database', view.databasePath],
      ['Listening on', view.boundTo],
      [
        'Scan refresh',
        view.refreshIntervalMs <= 0
          ? 'never — the scan taken at startup is shown until the dashboard is restarted'
          : `at most every ${String(Math.round(view.refreshIntervalMs / 1000))} s, on the next page request`,
      ],
      ['Current scan taken at', view.scannedAt],
    ]),
    '<h2>Report</h2>',
    facts([
      ['Report schema version', config.schemaVersion],
      ['Product version', config.metadata.productVersion],
      ['Host', `${config.metadata.hostPlatform}, Node ${config.metadata.nodeVersion}`],
    ]),
    '<h2>What this interface can and cannot do</h2>',
    table(
      [{ label: 'Capability' }, { label: 'State' }],
      [
        ['Read analysis and recorded history', 'yes'] as const,
        ['Modify the FiveM server', 'no — nothing in Sentinel Forge writes to it'] as const,
        ['Execute a command on the server', 'no'] as const,
        ['Change configuration', 'no — edit sentinel.config.json'] as const,
        ['Reach the network', 'no — the page loads no external resource and the product makes no outbound request'] as const,
        ['Accept a request that is not GET or HEAD', 'no'] as const,
      ],
      '',
    ),
    '<p class="note">Telemetry is off by default and nothing is sent anywhere. ' +
      'The dashboard binds to the loopback interface unless explicitly told otherwise.</p>',
  ].join('');
}
