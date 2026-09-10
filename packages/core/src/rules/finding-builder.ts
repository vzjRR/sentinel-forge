/**
 * Finding construction.
 *
 * All findings are created through this module so that four invariants hold
 * everywhere, without each rule having to remember them:
 *
 *   1. the rule id exists in the published catalog,
 *   2. the category matches the catalog entry (reports group by category),
 *   3. confidence is in range and rounded, so two runs produce identical output,
 *   4. anything above INFO carries evidence, and every excerpt is redacted.
 */

import {
  type Evidence,
  type Finding,
  getRule,
  normalizeConfidence,
  type RuleCategory,
  type Severity,
} from '@sentinel-forge/shared';
import { SentinelInternalError } from '../errors.js';
import { findingId } from '../ids.js';
import { redactText } from '../logging/redaction.js';

export interface CreateFindingInput {
  readonly ruleId: string;
  readonly severity: Severity;
  readonly confidence: number;
  readonly title: string;
  readonly summary: string;
  readonly recommendation: string;
  readonly evidence: readonly Evidence[];
  readonly resource?: string;
  readonly file?: string;
  readonly line?: number;
  readonly timestamp: string;
  /**
   * Distinguishes two findings from the same rule at the same location
   * (for example two different secrets on one line), keeping ids stable.
   */
  readonly discriminator?: string;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

/** Redacts free-text fields of an evidence record before it leaves a rule. */
export function redactEvidence(evidence: Evidence): Evidence {
  return {
    ...evidence,
    description: redactText(evidence.description),
    ...(evidence.excerpt === undefined ? {} : { excerpt: redactText(evidence.excerpt) }),
  };
}

/**
 * Builds a validated, redacted finding.
 *
 * @throws {SentinelInternalError} when an invariant is violated. These are
 *   developer errors in a rule, surfaced loudly rather than written to a report.
 */
export function createFinding(input: CreateFindingInput): Finding {
  const catalogEntry = getRule(input.ruleId);
  if (catalogEntry === undefined) {
    throw new SentinelInternalError(
      `Rule "${input.ruleId}" is not present in the rule catalog. Rule ids are a public contract and must be registered before use.`,
    );
  }

  const category: RuleCategory = catalogEntry.category;
  const confidence = normalizeConfidence(input.confidence);
  const evidence = input.evidence.map(redactEvidence);

  if (input.severity !== 'INFO' && evidence.length === 0) {
    throw new SentinelInternalError(
      `Rule "${input.ruleId}" produced a ${input.severity} finding without evidence. Findings above INFO must be traceable to an observation.`,
    );
  }

  if (input.title.trim().length === 0 || input.recommendation.trim().length === 0) {
    throw new SentinelInternalError(`Rule "${input.ruleId}" produced a finding without a title or recommendation.`);
  }

  return {
    id: findingId(input.ruleId, input.resource, input.file, input.line, input.discriminator ?? ''),
    ruleId: input.ruleId,
    category,
    severity: input.severity,
    confidence,
    title: redactText(input.title),
    summary: redactText(input.summary),
    recommendation: redactText(input.recommendation),
    evidence,
    ...(input.resource === undefined ? {} : { resource: input.resource }),
    ...(input.file === undefined ? {} : { file: input.file }),
    ...(input.line === undefined ? {} : { line: input.line }),
    timestamp: input.timestamp,
    ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
  };
}
