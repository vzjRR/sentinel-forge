/**
 * HTML building blocks shared by the report renderer and the dashboard.
 *
 * Every function here escapes its inputs. A caller must never hand-assemble a
 * tag around untrusted text; that rule is what makes reviewing this surface
 * tractable, because the escaping lives in one file rather than in every view.
 *
 * The components also encode two product rules that are easy to lose in a UI:
 *
 *   - **Severity and confidence are independent.** They are rendered as two
 *     separate things, never combined into one "risk" number.
 *   - **Absent is not zero.** {@link unavailable} exists so a view can say
 *     "not collected" in the place a value would have gone, rather than
 *     printing a plausible 0.
 *
 * © 2026 Talal Al Ghafri. All Rights Reserved.
 */

import {
  confidenceLabel,
  formatEvidenceLocation,
  type Evidence,
  type Finding,
  type Severity,
} from '@sentinel-forge/shared';
import { escapeAttribute, escapeHtml } from './escape.js';

/** A cell's value: already-escaped HTML is opted into explicitly. */
export interface RawHtml {
  readonly __html: string;
}

export function raw(html: string): RawHtml {
  return { __html: html };
}

export type Cell = string | number | RawHtml;

function renderCell(cell: Cell): string {
  if (typeof cell === 'number') return escapeHtml(String(cell));
  if (typeof cell === 'string') return escapeHtml(cell);
  return cell.__html;
}

export interface TableColumn {
  readonly label: string;
  /** Right-aligned and monospaced. Use for counts and measurements. */
  readonly numeric?: boolean;
}

/**
 * Renders a table, or a stated empty state.
 *
 * The empty text is required rather than defaulted: "no rows" means something
 * different on every page — nothing found, nothing collected, nothing yet
 * recorded — and a generic "No data" would blur exactly the distinction the
 * product exists to preserve.
 */
export function table(columns: readonly TableColumn[], rows: readonly (readonly Cell[])[], empty: string): string {
  if (rows.length === 0) return `<p class="empty">${escapeHtml(empty)}</p>`;

  const head = columns
    .map((column) => `<th${column.numeric === true ? ' class="num"' : ''}>${escapeHtml(column.label)}</th>`)
    .join('');

  const body = rows
    .map(
      (row) =>
        `<tr>${row
          .map((cell, index) => `<td${columns[index]?.numeric === true ? ' class="num"' : ''}>${renderCell(cell)}</td>`)
          .join('')}</tr>`,
    )
    .join('');

  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

/** A two-column list of facts. Values may be `undefined`, rendered as unavailable. */
export function facts(entries: readonly (readonly [string, Cell | undefined])[]): string {
  return table(
    [{ label: '' }, { label: '' }],
    entries.map(([label, value]) => [label, value ?? raw(unavailable())] as const),
    'Nothing to show.',
  );
}

/** Text for a value that was not collected. Never a zero, never a dash. */
export function unavailable(reason?: string): string {
  return `<span class="unavailable">Unavailable${reason === undefined ? '' : ` — ${escapeHtml(reason)}`}</span>`;
}

/** Text for a value nothing has collected yet, as distinct from one that cannot be. */
export function notCollected(reason?: string): string {
  return `<span class="unavailable">Not collected${reason === undefined ? '' : ` — ${escapeHtml(reason)}`}</span>`;
}

export function severityBadge(severity: Severity): string {
  // The severity name is inside the badge as text, so the meaning survives
  // without colour: a printed report and a colour-blind reader both work.
  return `<span class="badge ${escapeAttribute(severity)}">${escapeHtml(severity)}</span>`;
}

/**
 * Confidence, rendered as a number and its word.
 *
 * Deliberately separate from severity: a CRITICAL finding at 0.4 confidence and
 * a LOW finding at 0.99 are different situations, and a single combined score
 * would hide which one the reader is looking at.
 */
export function confidence(value: number): string {
  return `<span class="mono" title="Confidence is independent of severity">${escapeHtml(
    value.toFixed(2),
  )}</span> <span class="note">(${escapeHtml(confidenceLabel(value))})</span>`;
}

export function card(label: string, value: Cell, note?: string): string {
  return [
    '<div class="card">',
    `<div class="label">${escapeHtml(label)}</div>`,
    `<div class="value">${renderCell(value)}</div>`,
    note === undefined ? '' : `<div class="note">${escapeHtml(note)}</div>`,
    '</div>',
  ].join('');
}

export function meter(value: number, max: number, tone: 'critical' | 'high' | 'medium' | 'ok' | '' = ''): string {
  const percentage = max <= 0 ? 0 : Math.max(0, Math.min(100, Math.round((value / max) * 100)));
  return `<div class="meter ${escapeAttribute(tone)}"><span style="width:${String(percentage)}%"></span></div>`;
}

export function link(href: string, text: string, current = false): string {
  return `<a href="${escapeAttribute(href)}"${current ? ' aria-current="page"' : ''}>${escapeHtml(text)}</a>`;
}

function renderEvidence(evidence: Evidence): string {
  const parts = [
    `<li><span class="kind">${escapeHtml(evidence.kind)}</span> ${escapeHtml(evidence.description)}`,
  ];

  if (evidence.location !== undefined) {
    parts.push(` <span class="where">${escapeHtml(formatEvidenceLocation(evidence.location))}</span>`);
  }

  if (evidence.measurement !== undefined) {
    const { value, unit, sampleCount, baselineValue } = evidence.measurement;
    const baseline = baselineValue === undefined ? '' : `, baseline ${String(baselineValue)} ${unit}`;
    const samples = sampleCount === undefined ? '' : `, ${String(sampleCount)} sample(s)`;
    parts.push(
      `<div class="where">measured ${escapeHtml(String(value))} ${escapeHtml(unit)}${escapeHtml(
        baseline,
      )}${escapeHtml(samples)}</div>`,
    );
  }

  if (evidence.excerpt !== undefined && evidence.excerpt.length > 0) {
    // The excerpt is third-party source text and is the single most dangerous
    // thing rendered on any page. It is escaped, and it is never placed
    // anywhere but inside <pre> content.
    parts.push(`<pre class="excerpt">${escapeHtml(evidence.excerpt)}</pre>`);
  }

  parts.push('</li>');
  return parts.join('');
}

export interface FindingLinkOptions {
  /** Builds a link to a resource page, when the view has one. */
  readonly resourceHref?: (resource: string) => string;
}

export function findingCard(finding: Finding, options: FindingLinkOptions = {}): string {
  const location =
    finding.file === undefined
      ? ''
      : `<div class="where">${escapeHtml(finding.file)}${
          finding.line === undefined ? '' : `:${escapeHtml(String(finding.line))}`
        }</div>`;

  const resource =
    finding.resource === undefined
      ? ''
      : options.resourceHref === undefined
        ? `<span class="mono">${escapeHtml(finding.resource)}</span>`
        : link(options.resourceHref(finding.resource), finding.resource);

  return [
    '<article class="finding">',
    '<header>',
    severityBadge(finding.severity),
    `<span class="title">${escapeHtml(finding.title)}</span>`,
    `<span class="rule">${escapeHtml(finding.ruleId)}</span>`,
    `<span class="rule">confidence ${escapeHtml(finding.confidence.toFixed(2))}</span>`,
    resource,
    '</header>',
    '<div class="body">',
    location,
    `<p>${escapeHtml(finding.summary)}</p>`,
    finding.evidence.length === 0
      ? ''
      : `<ul class="evidence">${finding.evidence.map(renderEvidence).join('')}</ul>`,
    `<div class="recommendation">${escapeHtml(finding.recommendation)}</div>`,
    '</div>',
    '</article>',
  ].join('');
}

/**
 * The limitations block.
 *
 * Rendered by every page that shows analysis, and never conditional on being
 * non-empty: a page that omits what it does not establish misrepresents itself.
 */
export function limitations(entries: readonly string[]): string {
  if (entries.length === 0) return '';
  return [
    '<section class="limitations">',
    '<h2>Limitations</h2>',
    '<ul>',
    ...entries.map((entry) => `<li>${escapeHtml(entry)}</li>`),
    '</ul>',
    '</section>',
  ].join('');
}
