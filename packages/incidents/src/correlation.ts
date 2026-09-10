/**
 * Change correlation.
 *
 * The product's core claim is that it can relate a change to an effect. That
 * claim is only worth making if the relationship is stated carefully, so this
 * module is built around one rule:
 *
 *   **Temporal proximity is evidence of relatedness. It is never proof of cause.**
 *
 * Everything here produces a *confidence* that two observations belong to the
 * same story, together with the reasons for that number. Nothing produces a
 * cause. The wording used downstream is "likely related" and "temporally
 * correlated", never "caused by".
 */

export type SignalKind =
  | 'RESOURCE_CHANGED'
  | 'RESOURCE_ADDED'
  | 'RESOURCE_REMOVED'
  | 'CONFIG_CHANGED'
  | 'FINDING_INTRODUCED'
  | 'FINDING_RESOLVED'
  | 'PERFORMANCE_REGRESSION'
  | 'PERFORMANCE_IMPROVEMENT'
  | 'HEALTH_DROP'
  | 'RESOURCE_RESTART'
  | 'ERROR_SPIKE'
  | 'HITCH';

/** One observation with a time and, usually, a resource it belongs to. */
export interface Signal {
  readonly kind: SignalKind;
  readonly occurredAt: string;
  readonly resource?: string;
  readonly description: string;
  /** Finding this signal came from, when it came from one. */
  readonly findingId?: string;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

/** Signals that describe something changing on the server. */
const CAUSE_LIKE: ReadonlySet<SignalKind> = new Set([
  'RESOURCE_CHANGED',
  'RESOURCE_ADDED',
  'RESOURCE_REMOVED',
  'CONFIG_CHANGED',
  'RESOURCE_RESTART',
]);

/** Signals that describe something getting worse. */
const EFFECT_LIKE: ReadonlySet<SignalKind> = new Set([
  'PERFORMANCE_REGRESSION',
  'FINDING_INTRODUCED',
  'HEALTH_DROP',
  'ERROR_SPIKE',
  'HITCH',
]);

export interface CorrelationLink {
  readonly change: Signal;
  readonly effect: Signal;
  /** Milliseconds between the two, negative when the effect precedes the change. */
  readonly deltaMs: number;
  /** 0–1 that the two belong to the same story. Never a claim of causation. */
  readonly confidence: number;
  readonly reasons: readonly string[];
}

export interface CorrelationOptions {
  /**
   * How close in time two signals must be to be considered at all.
   * Default 30 minutes: wide enough to catch a restart followed by a slow
   * degradation, narrow enough that unrelated daily changes do not pair up.
   */
  readonly windowMs?: number;
}

export const DEFAULT_WINDOW_MS = 30 * 60 * 1000;

/**
 * Pairs change-like signals with effect-like signals that follow them.
 *
 * Confidence is built from three things a human would use:
 *   - whether the two concern the same resource,
 *   - how close together they are,
 *   - and whether the effect follows the change rather than preceding it.
 */
export function correlate(signals: readonly Signal[], options: CorrelationOptions = {}): CorrelationLink[] {
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const changes = signals.filter((signal) => CAUSE_LIKE.has(signal.kind));
  const effects = signals.filter((signal) => EFFECT_LIKE.has(signal.kind));
  const links: CorrelationLink[] = [];

  for (const change of changes) {
    const changeTime = Date.parse(change.occurredAt);
    if (Number.isNaN(changeTime)) continue;

    for (const effect of effects) {
      const effectTime = Date.parse(effect.occurredAt);
      if (Number.isNaN(effectTime)) continue;

      const deltaMs = effectTime - changeTime;
      if (Math.abs(deltaMs) > windowMs) continue;

      const reasons: string[] = [];
      let confidence = 0.2;

      if (change.resource !== undefined && change.resource === effect.resource) {
        confidence += 0.35;
        reasons.push(`Both observations concern ${change.resource}.`);
      } else if (change.resource !== undefined && effect.resource !== undefined) {
        reasons.push(`The observations concern different resources (${change.resource} and ${effect.resource}).`);
      }

      if (deltaMs >= 0) {
        // Proximity, scaled across the window: closer is stronger.
        const proximity = 1 - deltaMs / windowMs;
        confidence += 0.3 * proximity;
        reasons.push(
          deltaMs === 0
            ? 'The observations share a timestamp.'
            : `The effect was observed ${formatDuration(deltaMs)} after the change.`,
        );
      } else {
        // An effect that precedes its supposed cause is weak evidence, but not
        // nothing: recorded timestamps can be coarse.
        confidence -= 0.1;
        reasons.push(`The effect was observed ${formatDuration(-deltaMs)} *before* the change, which weakens the relationship.`);
      }

      if (change.kind === 'CONFIG_CHANGED') {
        confidence += 0.05;
        reasons.push('A configuration change affects the whole server, so it is a candidate for any effect in the window.');
      }

      links.push({
        change,
        effect,
        deltaMs,
        // Correlation alone never reaches certainty. The ceiling is deliberate.
        confidence: Math.round(Math.min(0.85, Math.max(0.05, confidence)) * 100) / 100,
        reasons,
      });
    }
  }

  return links.sort((a, b) => b.confidence - a.confidence || a.deltaMs - b.deltaMs);
}

export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m`;
  return `${(minutes / 60).toFixed(1)}h`;
}
