/**
 * Confidence model.
 *
 * Confidence is a 0.00–1.00 measure of how strongly the collected evidence
 * supports a finding. It never expresses impact — that is {@link Severity}.
 *
 * Bands (documented in docs/CLI.md and surfaced verbatim in reports):
 *   0.90–1.00 Very high
 *   0.75–0.89 High
 *   0.50–0.74 Moderate
 *   0.25–0.49 Low
 *   0.00–0.24 Very low
 */

export type ConfidenceBand = 'VERY_LOW' | 'LOW' | 'MODERATE' | 'HIGH' | 'VERY_HIGH';

export const CONFIDENCE_MIN = 0;
export const CONFIDENCE_MAX = 1;

export function isConfidence(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= CONFIDENCE_MIN && value <= CONFIDENCE_MAX;
}

/** Clamps into range and rounds to two decimals so reports stay deterministic. */
export function normalizeConfidence(value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError('Confidence must be a finite number between 0 and 1.');
  }
  const clamped = Math.min(CONFIDENCE_MAX, Math.max(CONFIDENCE_MIN, value));
  return Math.round(clamped * 100) / 100;
}

export function confidenceBand(value: number): ConfidenceBand {
  const confidence = normalizeConfidence(value);
  if (confidence >= 0.9) return 'VERY_HIGH';
  if (confidence >= 0.75) return 'HIGH';
  if (confidence >= 0.5) return 'MODERATE';
  if (confidence >= 0.25) return 'LOW';
  return 'VERY_LOW';
}

const BAND_LABELS: Readonly<Record<ConfidenceBand, string>> = Object.freeze({
  VERY_HIGH: 'Very high',
  HIGH: 'High',
  MODERATE: 'Moderate',
  LOW: 'Low',
  VERY_LOW: 'Very low',
});

export function confidenceLabel(value: number): string {
  return BAND_LABELS[confidenceBand(value)];
}
