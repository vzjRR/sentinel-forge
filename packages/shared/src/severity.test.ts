import { describe, expect, it } from 'vitest';
import {
  compareSeverity,
  countBySeverity,
  emptySeverityCounts,
  isAtLeastSeverity,
  isSeverity,
  maxSeverity,
  SEVERITIES,
  severityRank,
} from './severity.js';

describe('severity', () => {
  it('ranks severities in ascending order of impact', () => {
    const ranks = SEVERITIES.map(severityRank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it('recognises only the documented severities', () => {
    expect(isSeverity('HIGH')).toBe(true);
    expect(isSeverity('high')).toBe(false);
    expect(isSeverity('SEVERE')).toBe(false);
    expect(isSeverity(3)).toBe(false);
  });

  it('sorts ascending with compareSeverity', () => {
    const sorted = ['CRITICAL', 'INFO', 'HIGH', 'LOW'].sort((a, b) =>
      compareSeverity(a as never, b as never),
    );
    expect(sorted).toEqual(['INFO', 'LOW', 'HIGH', 'CRITICAL']);
  });

  it('applies a minimum severity threshold inclusively', () => {
    expect(isAtLeastSeverity('HIGH', 'HIGH')).toBe(true);
    expect(isAtLeastSeverity('CRITICAL', 'HIGH')).toBe(true);
    expect(isAtLeastSeverity('MEDIUM', 'HIGH')).toBe(false);
  });

  it('returns undefined for the maximum of an empty set rather than a default', () => {
    expect(maxSeverity([])).toBeUndefined();
    expect(maxSeverity(['LOW', 'CRITICAL', 'MEDIUM'])).toBe('CRITICAL');
  });

  it('counts findings by severity starting from zero for every level', () => {
    expect(emptySeverityCounts()).toEqual({ INFO: 0, LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 });
    expect(countBySeverity([{ severity: 'HIGH' }, { severity: 'HIGH' }, { severity: 'INFO' }])).toEqual({
      INFO: 1,
      LOW: 0,
      MEDIUM: 0,
      HIGH: 2,
      CRITICAL: 0,
    });
  });
});
