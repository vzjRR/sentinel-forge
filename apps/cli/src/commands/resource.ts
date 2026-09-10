/**
 * `sentinel resource <name>` — everything known about one resource.
 */

import { compareFindings, confidenceLabel, EXIT_CODES, isAtLeastSeverity } from '@sentinel-forge/shared';
import { SentinelUserError } from '@sentinel-forge/core';
import { dependenciesOf, dependentsOf } from '@sentinel-forge/dependencies';
import { eventsForResource } from '@sentinel-forge/analyzer';
import { formatTable, type CommandOutcome } from '../output.js';
import { resolveScanContext, runScan } from '../scan-context.js';
import { renderHealth } from './health.js';
import type { CommandContext, CommandDefinition } from './types.js';

export const resourceCommand: CommandDefinition = {
  name: 'resource',
  summary: 'Show health, findings, dependencies and events for one resource.',
  usage: 'resource <name> [--server <path>] [--json]',
  status: 'IMPLEMENTED',
  gate: 2,
  details: [
    'Reports what the current scan knows about a single resource: its health',
    'score with the deductions behind it, its findings with evidence, what it',
    'depends on, what depends on it, and the events it registers and triggers.',
  ],
  async run(context: CommandContext): Promise<CommandOutcome> {
    const name = context.positionals[0];
    if (name === undefined) {
      throw new SentinelUserError('No resource name was given.', {
        remediation: 'Name the resource to inspect:\n  sentinel resource sf_core',
      });
    }

    const resolved = await resolveScanContext(context);
    const result = await runScan(context, resolved, 'resource');

    const entry = result.report.resources.find((candidate) => candidate.resource.name === name);
    if (entry === undefined) {
      const available = result.report.resources.map((candidate) => candidate.resource.name).sort();
      throw new SentinelUserError(`Resource not found in the scanned server: ${name}`, {
        remediation:
          available.length === 0
            ? 'No resources were discovered. Check that --server points at the server root.'
            : `Discovered resources: ${available.slice(0, 20).join(', ')}${available.length > 20 ? ', …' : ''}`,
      });
    }

    const findings = result.report.findings
      .filter((finding) => finding.resource === name)
      .sort(compareFindings);

    const dependencies = dependenciesOf(result.graph, name);
    const dependents = dependentsOf(result.graph, name);
    const events = eventsForResource(result.eventGraph, name);
    const scripts = result.scripts.filter((script) => script.resource === name);

    const lines: string[] = [
      `Resource: ${entry.resource.name}`,
      '',
      formatTable([
        ['Path', entry.resource.path],
        ['Version', entry.resource.version ?? 'not declared'],
        ['Manifest', entry.resource.manifestKind],
        ['Files', String(entry.resource.fileCount)],
        ['Lua files analyzed', String(scripts.length)],
        ['Depends on', dependencies.length === 0 ? 'nothing' : dependencies.join(', ')],
        ['Depended on by', dependents.length === 0 ? 'nothing' : dependents.join(', ')],
      ]),
      '',
    ];

    if (entry.health !== undefined) {
      lines.push(...renderHealth(entry.health, 'Health'), '');
    }

    lines.push(`Findings (${String(findings.length)}):`);
    if (findings.length === 0) {
      lines.push('  none at or above the configured minimum severity.');
    } else {
      for (const finding of findings) {
        const location = finding.file === undefined ? '' : ` ${finding.file}${finding.line === undefined ? '' : `:${String(finding.line)}`}`;
        lines.push(
          `  ${finding.severity.padEnd(8)} ${finding.ruleId.padEnd(24)} ${finding.title}`,
          `           confidence ${finding.confidence.toFixed(2)} (${confidenceLabel(finding.confidence)})${location}`,
          `           → ${finding.recommendation}`,
        );
      }
    }
    lines.push('');

    lines.push(`Events (${String(events.length)}):`);
    if (events.length === 0) {
      lines.push('  none observed.');
    } else {
      for (const event of events.slice(0, 25)) {
        const registered = event.registrations.some((endpoint) => endpoint.resource === name);
        const triggered = event.triggers.some((endpoint) => endpoint.resource === name);
        const role = [registered ? 'registers' : '', triggered ? 'triggers' : ''].filter(Boolean).join(' and ');
        lines.push(`  ${event.event}  (${role}${event.broadcast ? ', broadcast' : ''}${event.network ? ', network' : ''})`);
      }
      if (events.length > 25) lines.push(`  … and ${String(events.length - 25)} more.`);
    }

    const failing = findings.some((finding) =>
      isAtLeastSeverity(finding.severity, resolved.loaded.config.analysis.failOnSeverity),
    );

    return {
      exitCode: failing ? EXIT_CODES.FINDINGS : EXIT_CODES.SUCCESS,
      text: lines.join('\n'),
      data: {
        resource: entry.resource,
        health: entry.health,
        findings,
        dependencies,
        dependents,
        events: events.map((event) => ({
          event: event.event,
          network: event.network,
          broadcast: event.broadcast,
          registeredBy: event.registrations.map((endpoint) => endpoint.resource),
          triggeredBy: event.triggers.map((endpoint) => endpoint.resource),
        })),
      },
    };
  },
};
