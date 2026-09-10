/**
 * Diagnostic rule interface.
 *
 * A rule is a pure analysis unit: it receives a prepared context, returns
 * findings, and performs no I/O of its own. That constraint is what makes rules
 * testable against fixtures, safe to run in any order, and cheap to run
 * repeatedly.
 *
 * Rules never execute scanned code. Analysis is textual and structural only.
 */

import type { Finding, RuleCategory, Severity } from '@sentinel-forge/shared';
import type { Clock } from '../clock.js';
import type { Logger } from '../logging/logger.js';

/**
 * Input a rule analyses. Concrete shapes are introduced by the gate that
 * delivers the corresponding analysis (file contents in GATE 1, parsed Lua in
 * GATE 2, samples in GATE 3), which is why this is generic rather than a fixed
 * union invented in advance.
 */
export interface RuleContext<TInput> {
  readonly input: TInput;
  /** Server-root-relative POSIX path the input came from, when file-based. */
  readonly filePath?: string;
  readonly resourceName?: string;
  readonly clock: Clock;
  readonly logger: Logger;
}

export interface RuleDefinition<TInput> {
  readonly id: string;
  readonly category: RuleCategory;
  readonly defaultSeverity: Severity;
  /** One line describing what the rule detects. */
  readonly description: string;
  /** Why a finding from this rule matters operationally. */
  readonly rationale: string;
  /**
   * Known benign patterns this rule can match. Documented per rule because a
   * false positive is treated as a product defect, not an acceptable cost.
   */
  readonly falsePositives: readonly string[];
  /**
   * Analyses the context and returns findings. Returning an empty array is the
   * normal outcome. A rule must not throw for malformed input: unparsable input
   * is a finding or a skip, never a crash of the whole scan.
   */
  analyze(context: RuleContext<TInput>): readonly Finding[] | Promise<readonly Finding[]>;
}

/** A rule paired with the reason it will not run, when disabled. */
export interface RuleActivation {
  readonly ruleId: string;
  readonly enabled: boolean;
  readonly reason?: string;
}
