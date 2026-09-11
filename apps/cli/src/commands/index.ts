/**
 * Command registry.
 *
 * Registers the complete command surface described by the product
 * specification. Every command in that specification is now implemented, so no
 * placeholder is registered here.
 *
 * `notImplementedCommand` is kept in the codebase rather than deleted: it is how
 * a command belonging to a later gate is declared, so that `sentinel help`
 * describes the real state of a build instead of hiding what is missing. Its
 * behaviour is covered directly by `run.test.ts`.
 */

import { baselineCommand } from './baseline.js';
import { compareCommand } from './compare.js';
import { dependenciesCommand } from './dependencies.js';
import { doctorCommand } from './doctor.js';
import { healthCommand } from './health.js';
import { incidentsCommand } from './incidents.js';
import { integrityCommand } from './integrity.js';
import { helpCommand, setCommandProvider } from './help.js';
import { initCommand } from './init.js';
import { purgeCommand } from './purge.js';
import { reportCommand } from './report.js';
import { securityCommand } from './security.js';
import { resourceCommand } from './resource.js';
import { scanCommand } from './scan.js';
import { versionCommand } from './version.js';
import type { CommandDefinition } from './types.js';

const COMMANDS: readonly CommandDefinition[] = Object.freeze([
  initCommand,
  scanCommand,
  healthCommand,
  resourceCommand,
  dependenciesCommand,
  baselineCommand,
  compareCommand,
  incidentsCommand,
  securityCommand,
  integrityCommand,
  reportCommand,
  purgeCommand,
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
