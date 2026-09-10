/**
 * Placeholder command factory.
 *
 * Commands that belong to a later gate are registered so that `sentinel help`
 * shows the complete surface and so that a scripted invocation gets an explicit
 * "not in this build" answer instead of "unknown command", which would be
 * indistinguishable from a typo.
 */

import { SentinelNotImplementedError } from '@sentinel-forge/core';
import type { CommandDefinition } from './types.js';

export interface NotImplementedCommandSpec {
  readonly name: string;
  readonly summary: string;
  readonly usage: string;
  readonly gate: number;
  readonly details?: readonly string[];
}

export function notImplementedCommand(spec: NotImplementedCommandSpec): CommandDefinition {
  return {
    name: spec.name,
    summary: spec.summary,
    usage: spec.usage,
    status: 'NOT_IMPLEMENTED',
    gate: spec.gate,
    ...(spec.details === undefined ? {} : { details: spec.details }),
    run(): Promise<never> {
      return Promise.reject(
        new SentinelNotImplementedError(`\`sentinel ${spec.name}\``, spec.gate, {
          remediation: `Track delivery in docs/GATE_STATUS.md. Commands available in this build: sentinel help.`,
          details: { command: spec.name, targetGate: spec.gate },
        }),
      );
    },
  };
}
