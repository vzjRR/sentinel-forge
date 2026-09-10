/**
 * `sentinel dependencies` — the resource dependency graph.
 */

import { EXIT_CODES } from '@sentinel-forge/shared';
import { formatTable, type CommandOutcome } from '../output.js';
import { hasFailingFindings, resolveScanContext, runScan } from '../scan-context.js';
import type { CommandContext, CommandDefinition } from './types.js';

export const dependenciesCommand: CommandDefinition = {
  name: 'dependencies',
  summary: 'Show the resource dependency graph and unresolved dependencies.',
  usage: 'dependencies [--server <path>] [--json]',
  status: 'IMPLEMENTED',
  gate: 1,
  details: [
    'Builds the dependency graph from declared dependencies and from',
    '@resource/file references discovered in manifests, then reports unresolved',
    'edges and cycles.',
    '',
    'A resource declaring `provide` satisfies dependencies on the provided name.',
    'Entries beginning with / (for example /server:4500 or /onesync) are runtime',
    'constraints rather than resources and are listed separately.',
  ],
  async run(context: CommandContext): Promise<CommandOutcome> {
    const resolved = await resolveScanContext(context);
    const result = await runScan(context, resolved, 'dependencies');
    const { graph } = result;

    const lines: string[] = [
      `Dependency graph for ${resolved.serverPath}`,
      '',
      formatTable([
        ['Resources', String(graph.nodes.length)],
        ['Edges', String(graph.edges.length)],
        ['Unresolved', String(graph.unresolved.length)],
        ['Cycles', String(graph.cycles.length)],
        ['Runtime constraints', String(graph.runtimeConstraints.length)],
      ]),
      '',
    ];

    if (graph.edges.length === 0) {
      lines.push('No dependencies are declared or discovered in this server.');
    } else {
      lines.push('Edges:');
      for (const edge of graph.edges) {
        const marker = edge.resolved ? '->' : '-X';
        const provided = graph.providers.get(edge.to);
        const via = provided !== undefined && provided !== edge.to ? ` (provided by ${provided})` : '';
        lines.push(`  ${edge.from} ${marker} ${edge.to}${via}  [${edge.kind.toLowerCase()}]`);
      }
      lines.push('');
    }

    if (graph.unresolved.length > 0) {
      lines.push('Unresolved:');
      for (const edge of graph.unresolved) {
        lines.push(`  ${edge.from} -X ${edge.to}  [${edge.kind.toLowerCase()}]`);
      }
      lines.push('');
    }

    if (graph.cycles.length > 0) {
      lines.push('Cycles:');
      for (const cycle of graph.cycles) {
        lines.push(`  ${[...cycle, cycle[0] ?? ''].join(' -> ')}`);
      }
      lines.push('');
    }

    if (graph.runtimeConstraints.length > 0) {
      lines.push('Runtime constraints (not resources):');
      for (const constraint of graph.runtimeConstraints) {
        lines.push(`  ${constraint.resource} requires ${constraint.constraint}`);
      }
      lines.push('');
    }

    const dependencyFindings = result.report.findings.filter((finding) => finding.ruleId.startsWith('DEP-'));

    return {
      exitCode: hasFailingFindings(dependencyFindings, resolved.loaded.config.analysis.failOnSeverity)
        ? EXIT_CODES.FINDINGS
        : EXIT_CODES.SUCCESS,
      text: lines.join('\n').trimEnd(),
      data: {
        nodes: graph.nodes,
        edges: graph.edges,
        unresolved: graph.unresolved,
        cycles: graph.cycles,
        runtimeConstraints: graph.runtimeConstraints,
        providers: Object.fromEntries(graph.providers),
        findings: dependencyFindings,
      },
    };
  },
};
