/**
 * `sentinel help` — command surface, options and exit codes.
 *
 * Help distinguishes commands available in this build from those a later gate
 * delivers, so the documented surface never overstates what the binary does.
 */

import { EXIT_CODE_DESCRIPTIONS, PRODUCT_NAME, PRODUCT_SUBTITLE, PRODUCT_VERSION, listRules } from '@sentinel-forge/shared';
import { SentinelUserError } from '@sentinel-forge/core';
import { OPTION_SPECS } from '../args.js';
import { formatTable, ok, type CommandOutcome } from '../output.js';
import type { CommandContext, CommandDefinition } from './types.js';

/** Set by the registry to avoid a circular import between help and the registry. */
let commandProvider: () => readonly CommandDefinition[] = () => [];

export function setCommandProvider(provider: () => readonly CommandDefinition[]): void {
  commandProvider = provider;
}

function renderOverview(): string {
  const commands = commandProvider();
  const available = commands.filter((command) => command.status === 'IMPLEMENTED');
  const planned = commands.filter((command) => command.status === 'NOT_IMPLEMENTED');

  const sections = [
    `${PRODUCT_NAME} ${PRODUCT_VERSION} — ${PRODUCT_SUBTITLE}`,
    '',
    'Usage: sentinel <command> [options]',
    '',
    'Available in this build:',
    formatTable(available.map((command) => [command.name, command.summary] as const)),
  ];

  if (planned.length > 0) {
    sections.push(
      '',
      'Declared but NOT IMPLEMENTED in this build (see docs/GATE_STATUS.md):',
      formatTable(planned.map((command) => [command.name, `${command.summary} [GATE ${command.gate}]`] as const)),
    );
  }

  sections.push(
    '',
    'Options:',
    formatTable(
      OPTION_SPECS.map(
        (spec) =>
          [
            `${spec.aliases.join(', ')}${spec.takesValue ? ` <${spec.valueName ?? 'value'}>` : ''}`,
            spec.description,
          ] as const,
      ),
    ),
    '',
    'Exit codes:',
    formatTable(
      Object.entries(EXIT_CODE_DESCRIPTIONS).map(([code, description]) => [code, description] as const),
    ),
    '',
    'Topics:',
    formatTable([['sentinel help rules', 'List the diagnostic rule catalog and its delivery status.']]),
  );

  return sections.join('\n');
}

function renderCommandHelp(command: CommandDefinition): string {
  const lines = [
    `sentinel ${command.usage}`,
    '',
    command.summary,
  ];
  if (command.status === 'NOT_IMPLEMENTED') {
    lines.push('', `Status: NOT IMPLEMENTED in this build. Planned for GATE ${command.gate}.`);
  }
  if (command.details !== undefined && command.details.length > 0) {
    lines.push('', ...command.details);
  }
  return lines.join('\n');
}

function renderRules(): { text: string; data: Record<string, unknown> } {
  const rules = listRules();
  const text = [
    'Diagnostic rule catalog',
    '',
    formatTable(
      rules.map(
        (rule) =>
          [
            rule.id,
            `${rule.category.padEnd(14)} ${rule.defaultSeverity.padEnd(8)} ${
              rule.status === 'IMPLEMENTED' ? 'implemented' : `GATE ${String(rule.targetGate)}`
            }  ${rule.title}`,
          ] as const,
      ),
    ),
    '',
    'Rule ids are a stable contract. See docs/API.md for the finding schema.',
  ].join('\n');

  return {
    text,
    data: {
      rules: rules.map((rule) => ({
        id: rule.id,
        category: rule.category,
        defaultSeverity: rule.defaultSeverity,
        status: rule.status,
        targetGate: rule.targetGate,
        title: rule.title,
        rationale: rule.rationale,
        falsePositives: rule.falsePositives,
      })),
    },
  };
}

export const helpCommand: CommandDefinition = {
  name: 'help',
  summary: 'Show usage, the command surface, and the rule catalog.',
  usage: 'help [command|rules]',
  status: 'IMPLEMENTED',
  gate: 0,
  run(context: CommandContext): Promise<CommandOutcome> {
    const topic = context.positionals[0];

    if (topic === undefined) {
      return Promise.resolve(
        ok(renderOverview(), {
          commands: commandProvider().map((command) => ({
            name: command.name,
            summary: command.summary,
            status: command.status,
            gate: command.gate,
          })),
        }),
      );
    }

    if (topic === 'rules') {
      const rendered = renderRules();
      return Promise.resolve(ok(rendered.text, rendered.data));
    }

    const command = commandProvider().find((candidate) => candidate.name === topic);
    if (command === undefined) {
      return Promise.reject(
        new SentinelUserError(`Unknown help topic: ${topic}`, {
          remediation: 'Run `sentinel help` for the list of commands.',
        }),
      );
    }

    return Promise.resolve(
      ok(renderCommandHelp(command), {
        command: command.name,
        status: command.status,
        gate: command.gate,
        usage: command.usage,
      }),
    );
  },
};
