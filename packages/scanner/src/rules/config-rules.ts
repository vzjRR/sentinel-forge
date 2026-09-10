/**
 * Server configuration rules.
 *
 * CFG-ENSURE-MISSING-001 — the configuration starts a resource that is not
 * present in the scanned resource directories.
 */

import { createFinding, type Clock } from '@sentinel-forge/core';
import type { Finding } from '@sentinel-forge/shared';
import type { ParsedServerConfig } from '../config/server-config.js';
import { isBundledResource } from '../discovery/platform-resources.js';

export interface ConfigRuleContext {
  readonly config: ParsedServerConfig;
  /** Server-relative path of the configuration file, for evidence. */
  readonly configPath: string;
  /** Names of every resource discovered on disk. */
  readonly discoveredResources: ReadonlySet<string>;
  /** Names declared by `provide` in any discovered manifest. */
  readonly providedNames: ReadonlySet<string>;
  readonly clock: Clock;
}

export function analyzeServerConfig(context: ConfigRuleContext): Finding[] {
  const timestamp = context.clock.now().toISOString();
  const findings: Finding[] = [];
  const reported = new Set<string>();

  for (const directive of context.config.resourceDirectives) {
    // `stop` on something absent is harmless. Only directives that intend to
    // run a resource are worth reporting.
    if (directive.command === 'stop') continue;

    // A category target affects every resource inside the category rather than
    // naming one, so it can never be a missing resource.
    if (directive.isCategory) continue;

    if (context.discoveredResources.has(directive.target)) continue;
    if (context.providedNames.has(directive.target)) continue;
    if (reported.has(directive.target)) continue;
    reported.add(directive.target);

    const bundled = isBundledResource(directive.target);

    findings.push(
      createFinding({
        ruleId: 'CFG-ENSURE-MISSING-001',
        // A resource shipped with the official server data set is expected to be
        // absent from the operator's own resources directory, so the same
        // observation carries much weaker evidence of a real problem.
        severity: bundled ? 'INFO' : 'HIGH',
        confidence: bundled ? 0.2 : 0.9,
        title: bundled
          ? 'Configuration starts a resource provided by the server data set'
          : 'Configuration starts a resource that was not found',
        summary: bundled
          ? `"${directive.target}" is started by the configuration and was not found in the scanned resource directories. It is part of the official server data set, so this is expected when that data set lives outside the scanned path.`
          : `The configuration runs "${directive.command} ${directive.target}", but no resource with that name was found in the scanned resource directories.`,
        recommendation: bundled
          ? 'No action needed if the server data set is installed outside the scanned directories. Add its directory to server.resourceDirectories to include it in analysis.'
          : 'Install the resource, correct the name, or remove the directive.',
        evidence: [
          {
            kind: 'FILE_REFERENCE',
            description: `Configuration line running "${directive.command}".`,
            location: { file: context.configPath, line: directive.line },
            excerpt: `${directive.command} ${directive.target}`,
          },
          {
            kind: 'CONFIG_VALUE',
            description: 'Resource names discovered on disk.',
            metadata: { discoveredResourceCount: context.discoveredResources.size },
          },
        ],
        file: context.configPath,
        line: directive.line,
        timestamp,
        discriminator: directive.target,
        metadata: { target: directive.target, command: directive.command, bundled },
      }),
    );
  }

  return findings;
}
