/**
 * Static performance rules.
 *
 * PERF-LOOP-001   a continuous loop with no observable yield
 * PERF-EVENT-001  a network event triggered from a hot path
 * PERF-QUERY-001  a database query per loop iteration, or an unbounded select
 *
 * Each rule is written to be quiet by default. On a FiveM server the same
 * patterns appear in correct code as well as incorrect code, so the deciding
 * factor is context: whether the loop can ever end, whether it yields, and how
 * often it runs. Where the context is unavailable, confidence drops rather than
 * the finding being suppressed or inflated.
 */

import { createFinding, type Clock } from '@sentinel-forge/core';
import type { Evidence, Finding } from '@sentinel-forge/shared';
import type { LoopFact, ScriptAnalysis } from '../lua/script.js';

export interface PerformanceRuleContext {
  readonly script: ScriptAnalysis;
  readonly clock: Clock;
}

/** A wait shorter than this is treated as a per-frame interval. */
const FRAME_INTERVAL_MS = 50;

function loopDescription(fact: LoopFact): string {
  switch (fact.loop.kind) {
    case 'WHILE':
      return 'while loop';
    case 'FOR':
      return 'for loop';
    case 'REPEAT':
      return 'repeat loop';
    default:
      return 'loop';
  }
}

/**
 * PERF-LOOP-001 — a loop that cannot end and never yields.
 *
 * Only continuous loops are considered. A `for` loop over a collection, or a
 * `while` with a real condition, terminates on its own; "no yield in the body"
 * says nothing about it. `Wait(0)` is a legitimate per-frame pattern and is
 * explicitly *not* reported here — it yields.
 */
export function analyzeLoops(context: PerformanceRuleContext): Finding[] {
  const { script, clock } = context;
  const timestamp = clock.now().toISOString();
  const findings: Finding[] = [];

  for (const fact of script.loops) {
    if (!fact.continuous) continue;
    if (fact.yields) continue;

    // A body containing calls this analysis cannot follow could yield inside one
    // of them, so confidence drops — but not far. A continuous loop with no
    // visible yield is the classic cause of a frozen thread, and the pattern is
    // worth a reviewer's attention even when one call cannot be followed.
    // Source that did not balance is a different matter: the body range itself
    // is then approximate, so the finding rests on much weaker ground.
    const opaque = fact.opaqueCallCount > 0;
    const confidence = script.unbalanced ? 0.5 : opaque ? 0.75 : 0.9;

    const evidence: Evidence[] = [
      {
        kind: 'CODE_PATTERN',
        description: `A ${loopDescription(fact)} whose condition never ends, with no Wait or other yielding call in its body.`,
        location: { file: script.filePath, line: fact.loop.line, column: fact.loop.column },
        metadata: {
          loopKind: fact.loop.kind,
          insideThread: fact.insideThread,
          unfollowedCalls: fact.opaqueCallCount,
        },
      },
    ];

    if (opaque) {
      evidence.push({
        kind: 'CODE_PATTERN',
        description: `The body calls ${String(fact.opaqueCallCount)} function(s) this analysis does not follow; one of them could yield.`,
        location: { file: script.filePath, line: fact.loop.line },
      });
    }

    findings.push(
      createFinding({
        ruleId: 'PERF-LOOP-001',
        severity: fact.insideThread ? 'HIGH' : 'MEDIUM',
        confidence,
        title: 'Loop without an observable yield',
        summary: `A ${loopDescription(fact)} in ${script.resource} runs continuously with no observable yield. A thread that never yields occupies the scheduler and is a common source of server-wide hitching.`,
        recommendation:
          'Add a Wait() inside the loop body. Wait(0) is appropriate for per-frame work; a longer interval is better where the work does not need to run every frame.',
        evidence,
        resource: script.resource,
        file: script.filePath,
        line: fact.loop.line,
        timestamp,
        discriminator: `loop-${String(fact.loop.line)}-${String(fact.loop.column)}`,
        metadata: { loopKind: fact.loop.kind, insideThread: fact.insideThread },
      }),
    );
  }

  return findings;
}

/**
 * PERF-EVENT-001 — a network event triggered from a hot path.
 *
 * A trigger inside a loop that runs every frame multiplies bandwidth and server
 * CPU by the frame rate. A trigger inside a loop with a long interval, or a
 * bounded loop, is ordinary code and is not reported.
 */
export function analyzeEventFrequency(context: PerformanceRuleContext): Finding[] {
  const { script, clock } = context;
  const timestamp = clock.now().toISOString();
  const findings: Finding[] = [];

  for (const event of script.events) {
    if (event.kind !== 'TRIGGER') continue;
    if (event.direction === 'local') continue;
    const fact = event.loop;
    if (fact === undefined) continue;

    // Only a hot loop matters: continuous with no wait, or a wait below a frame
    // interval. A bounded `for` loop sending a handful of events is fine.
    const hot =
      (fact.continuous && !fact.yields) ||
      (fact.continuous && fact.waitMs !== undefined && fact.waitMs < FRAME_INTERVAL_MS);
    if (!hot) continue;

    const interval = fact.waitMs;
    const confidence = interval === undefined ? 0.7 : 0.85;

    findings.push(
      createFinding({
        ruleId: 'PERF-EVENT-001',
        severity: 'MEDIUM',
        confidence,
        title: 'Network event triggered from a hot path',
        summary: `${event.call}${event.event === undefined ? '' : ` ("${event.event}")`} is called from a loop that runs ${
          interval === undefined ? 'without any wait' : `every ${String(interval)} ms`
        }. Event traffic at that rate costs bandwidth and server CPU disproportionately to the work performed.`,
        recommendation:
          'Send only when the value being reported changes, or raise the loop interval. Where the server needs continuous position data, prefer a state bag or an existing synchronisation mechanism over a per-frame event.',
        evidence: [
          {
            kind: 'CODE_PATTERN',
            description: `${event.call} inside a ${loopDescription(fact)}.`,
            location: { file: script.filePath, line: event.line, column: event.column },
            ...(event.event === undefined ? {} : { excerpt: `${event.call}('${event.event}', …)` }),
          },
          {
            kind: 'CODE_PATTERN',
            description:
              interval === undefined
                ? 'The enclosing loop has no literal wait interval.'
                : `The enclosing loop waits ${String(interval)} ms per iteration.`,
            location: { file: script.filePath, line: fact.loop.line },
            ...(interval === undefined
              ? {}
              : { measurement: { value: interval, unit: 'ms', sampleCount: 1 } }),
          },
        ],
        resource: script.resource,
        file: script.filePath,
        line: event.line,
        timestamp,
        discriminator: `event-${String(event.line)}-${event.event ?? event.call}`,
        metadata: {
          call: event.call,
          ...(event.event === undefined ? {} : { event: event.event }),
          ...(interval === undefined ? {} : { loopIntervalMs: interval }),
        },
      }),
    );
  }

  return findings;
}

/**
 * PERF-QUERY-001 — query cost that grows with data or iteration count.
 *
 * Two distinct observations, reported separately:
 * a query executed once per loop iteration, and a SELECT with no bound on the
 * rows it returns.
 */
export function analyzeQueries(context: PerformanceRuleContext): Finding[] {
  const { script, clock } = context;
  const timestamp = clock.now().toISOString();
  const findings: Finding[] = [];

  for (const query of script.queries) {
    if (query.loop !== undefined) {
      const bounded = query.loop.loop.kind === 'FOR';
      findings.push(
        createFinding({
          ruleId: 'PERF-QUERY-001',
          severity: bounded ? 'MEDIUM' : 'HIGH',
          // A query inside a loop is a fact about the code. What is uncertain is
          // how many iterations run, which is why a bounded loop scores lower.
          confidence: bounded ? 0.8 : 0.85,
          title: 'Database query inside a loop',
          summary: `${query.call} is called inside a ${loopDescription(query.loop)} in ${script.resource}. Each iteration is a separate database round trip, so the cost grows with the iteration count.`,
          recommendation:
            'Fetch the rows once before the loop, or rewrite the statement to operate on the whole set (an IN clause, a JOIN, or a batched insert).',
          evidence: [
            {
              kind: 'CODE_PATTERN',
              description: `${query.call} called inside a loop.`,
              location: { file: script.filePath, line: query.line, column: query.column },
              ...(query.sql === undefined ? {} : { excerpt: query.sql }),
            },
            {
              kind: 'CODE_PATTERN',
              description: `Enclosing ${loopDescription(query.loop)}.`,
              location: { file: script.filePath, line: query.loop.loop.line },
            },
          ],
          resource: script.resource,
          file: script.filePath,
          line: query.line,
          timestamp,
          discriminator: `query-loop-${String(query.line)}`,
          metadata: { call: query.call, loopKind: query.loop.loop.kind },
        }),
      );
    }

    if (query.isSelect && !query.hasLimit && !query.hasWhere) {
      findings.push(
        createFinding({
          ruleId: 'PERF-QUERY-001',
          severity: 'LOW',
          // The table may legitimately be small; this is a prompt to check, not
          // an assertion that the query is wrong.
          confidence: 0.6,
          title: 'SELECT with no WHERE or LIMIT clause',
          summary: `A SELECT in ${script.resource} has neither a WHERE nor a LIMIT clause, so the rows returned grow with the table.`,
          recommendation:
            'Add a WHERE clause, a LIMIT, or both, unless the table is known to stay small.',
          evidence: [
            {
              kind: 'CODE_PATTERN',
              description: 'SELECT statement with no row bound.',
              location: { file: script.filePath, line: query.line, column: query.column },
              ...(query.sql === undefined ? {} : { excerpt: query.sql }),
            },
          ],
          resource: script.resource,
          file: script.filePath,
          line: query.line,
          timestamp,
          discriminator: `query-unbounded-${String(query.line)}`,
          metadata: { call: query.call },
        }),
      );
      continue;
    }

    if (query.selectsEveryColumn) {
      findings.push(
        createFinding({
          ruleId: 'PERF-QUERY-001',
          severity: 'INFO',
          confidence: 0.5,
          title: 'SELECT retrieves every column',
          summary: `A SELECT in ${script.resource} uses \`SELECT *\`, so every column is transferred whether or not it is used.`,
          recommendation:
            'Name the columns the code actually reads. This is a minor cost on a narrow table and a significant one on a wide table.',
          evidence: [
            {
              kind: 'CODE_PATTERN',
              description: 'SELECT * statement.',
              location: { file: script.filePath, line: query.line, column: query.column },
              ...(query.sql === undefined ? {} : { excerpt: query.sql }),
            },
          ],
          resource: script.resource,
          file: script.filePath,
          line: query.line,
          timestamp,
          discriminator: `query-star-${String(query.line)}`,
          metadata: { call: query.call },
        }),
      );
    }
  }

  return findings;
}

/** Runs every static performance rule over one script. */
export function analyzePerformance(context: PerformanceRuleContext): Finding[] {
  return [...analyzeLoops(context), ...analyzeEventFrequency(context), ...analyzeQueries(context)];
}
