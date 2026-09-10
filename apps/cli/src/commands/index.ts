/**
 * Command registry.
 *
 * Registers the complete command surface described by the product
 * specification. Commands delivered by a later gate are present but declared
 * NOT IMPLEMENTED, so `sentinel help` describes the real state of the build.
 */

import { dependenciesCommand } from './dependencies.js';
import { doctorCommand } from './doctor.js';
import { helpCommand, setCommandProvider } from './help.js';
import { initCommand } from './init.js';
import { notImplementedCommand } from './not-implemented.js';
import { reportCommand } from './report.js';
import { scanCommand } from './scan.js';
import { versionCommand } from './version.js';
import type { CommandDefinition } from './types.js';

const COMMANDS: readonly CommandDefinition[] = Object.freeze([
  initCommand,
  scanCommand,
  notImplementedCommand({
    name: 'health',
    summary: 'Show the explainable server health score.',
    usage: 'health [--server <path>] [--json]',
    gate: 2,
  }),
  notImplementedCommand({
    name: 'resource',
    summary: 'Show health, findings and dependencies for one resource.',
    usage: 'resource <name> [--json]',
    gate: 2,
  }),
  dependenciesCommand,
  notImplementedCommand({
    name: 'baseline',
    summary: 'Create, list and inspect performance baselines.',
    usage: 'baseline <create|list|show> [--json]',
    gate: 3,
  }),
  notImplementedCommand({
    name: 'compare',
    summary: 'Compare two baselines and report regressions.',
    usage: 'compare <baseline-a> <baseline-b> [--json]',
    gate: 3,
  }),
  notImplementedCommand({
    name: 'incidents',
    summary: 'List correlated incidents and their timelines.',
    usage: 'incidents [--json]',
    gate: 3,
  }),
  notImplementedCommand({
    name: 'security',
    summary: 'Show security indicators with evidence and confidence.',
    usage: 'security [--json]',
    gate: 4,
  }),
  notImplementedCommand({
    name: 'integrity',
    summary: 'Create and compare file integrity snapshots.',
    usage: 'integrity <snapshot|compare> [--json]',
    gate: 4,
  }),
  reportCommand,
  notImplementedCommand({
    name: 'purge',
    summary: 'Delete locally stored Sentinel Forge data.',
    usage: 'purge [--json]',
    gate: 3,
    details: [
      'Deletes local diagnostic history according to the retention configuration.',
      'Nothing belonging to the FiveM server is ever deleted.',
    ],
  }),
  doctorCommand,
  versionCommand,
  helpCommand,
]);

setCommandProvider(() => COMMANDS);

export function listCommands(): readonly CommandDefinition[] {
  return COMMANDS;
}

export function findCommand(name: string): CommandDefinition | undefined {
  return COMMANDS.find((command) => command.name === name);
}

/** Suggests a command when the supplied name is close to a real one. */
export function suggestCommand(name: string): string | undefined {
  const lower = name.toLowerCase();
  let best: { name: string; distance: number } | undefined;

  for (const command of COMMANDS) {
    const distance = editDistance(lower, command.name);
    if (distance <= 2 && (best === undefined || distance < best.distance)) {
      best = { name: command.name, distance };
    }
  }
  return best?.name;
}

/** Levenshtein distance, used only for "did you mean" suggestions. */
function editDistance(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_value, index) => index);
  const current = new Array<number>(b.length + 1).fill(0);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        (current[j - 1] ?? 0) + 1,
        (previous[j] ?? 0) + 1,
        (previous[j - 1] ?? 0) + substitutionCost,
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[b.length] ?? Math.max(a.length, b.length);
}
