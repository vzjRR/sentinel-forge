import { describe, expect, it } from 'vitest';
import { confidenceBand, confidenceLabel, isConfidence, normalizeConfidence } from './confidence.js';

describe('confidence', () => {
  it('accepts only finite values within 0..1', () => {
    expect(isConfidence(0)).toBe(true);
    expect(isConfidence(1)).toBe(true);
    expect(isConfidence(0.73)).toBe(true);
    expect(isConfidence(1.01)).toBe(false);
    expect(isConfidence(-0.1)).toBe(false);
    expect(isConfidence(Number.NaN)).toBe(false);
    expect(isConfidence('0.5')).toBe(false);
  });

  it('clamps out-of-range values and rounds to two decimals for deterministic output', () => {
    expect(normalizeConfidence(1.4)).toBe(1);
    expect(normalizeConfidence(-2)).toBe(0);
    expect(normalizeConfidence(0.786)).toBe(0.79);
    expect(normalizeConfidence(0.784)).toBe(0.78);
  });

  it('rejects non-finite input rather than silently substituting a value', () => {
    expect(() => normalizeConfidence(Number.NaN)).toThrow(RangeError);
    expect(() => normalizeConfidence(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it('maps values onto the documented bands at their boundaries', () => {
    expect(confidenceBand(1)).toBe('VERY_HIGH');
    expect(confidenceBand(0.9)).toBe('VERY_HIGH');
    expect(confidenceBand(0.89)).toBe('HIGH');
    expect(confidenceBand(0.75)).toBe('HIGH');
    expect(confidenceBand(0.74)).toBe('MODERATE');
    expect(confidenceBand(0.5)).toBe('MODERATE');
    expect(confidenceBand(0.49)).toBe('LOW');
    expect(confidenceBand(0.25)).toBe('LOW');
    expect(confidenceBand(0.24)).toBe('VERY_LOW');
    expect(confidenceBand(0)).toBe('VERY_LOW');
  });

  it('labels bands with the wording used in reports', () => {
    expect(confidenceLabel(0.96)).toBe('Very high');
    expect(confidenceLabel(0.6)).toBe('Moderate');
  });
});
