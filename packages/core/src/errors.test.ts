import { describe, expect, it } from 'vitest';
import { EXIT_CODES } from '@sentinel-forge/shared';
import {
  SentinelConfigError,
  SentinelInternalError,
  SentinelNotImplementedError,
  SentinelSecurityError,
  SentinelUserError,
  isSentinelError,
  newErrorId,
  toSentinelError,
} from './errors.js';

describe('error model', () => {
  it('maps each error class to its documented exit code', () => {
    expect(new SentinelUserError('bad input').exitCode).toBe(EXIT_CODES.INVALID_INPUT);
    expect(new SentinelConfigError('bad config').exitCode).toBe(EXIT_CODES.INVALID_INPUT);
    expect(new SentinelSecurityError('escaped root').exitCode).toBe(EXIT_CODES.SECURITY_FAILURE);
    expect(new SentinelInternalError('unexpected').exitCode).toBe(EXIT_CODES.INTERNAL_ERROR);
    expect(new SentinelNotImplementedError('`sentinel scan`', 1).exitCode).toBe(EXIT_CODES.INVALID_INPUT);
  });

  it('generates a distinct, referenceable error id per error', () => {
    const first = new SentinelUserError('a');
    const second = new SentinelUserError('a');
    expect(first.errorId).toMatch(/^SF-[0-9A-F]{8}$/);
    expect(first.errorId).not.toBe(second.errorId);
    expect(newErrorId()).toMatch(/^SF-[0-9A-F]{8}$/);
  });

  it('redacts secrets that reach an error message or remediation', () => {
    const error = new SentinelUserError('Could not connect using password = "EXAMPLE_NOT_A_REAL_PASSWORD"', {
      remediation: 'Check token = "EXAMPLE_FIXTURE_TOKEN_0000"',
    });
    expect(error.message).not.toContain('EXAMPLE_NOT_A_REAL_PASSWORD');
    expect(error.remediation).not.toContain('EXAMPLE_FIXTURE_TOKEN_0000');
  });

  it('states the target gate for a capability that is not built yet', () => {
    const error = new SentinelNotImplementedError('`sentinel scan`', 1);
    expect(error.message).toContain('NOT IMPLEMENTED');
    expect(error.message).toContain('GATE 1');
    expect(error.toJSON()['targetGate']).toBe(1);
  });

  it('serializes safely for --json output', () => {
    const payload = new SentinelConfigError('Configuration is not valid', {
      remediation: 'Correct the listed values.',
      details: { configPath: 'sentinel.config.json' },
    }).toJSON();
    expect(payload['category']).toBe('CONFIG');
    expect(payload['exitCode']).toBe(EXIT_CODES.INVALID_INPUT);
    expect(payload['details']).toEqual({ configPath: 'sentinel.config.json' });
  });

  it('normalizes unknown thrown values into an internal error', () => {
    expect(toSentinelError(new SentinelUserError('kept')).category).toBe('USER');
    expect(toSentinelError(new Error('wrapped')).category).toBe('INTERNAL');
    expect(toSentinelError('a string').category).toBe('INTERNAL');
    expect(isSentinelError(toSentinelError(42))).toBe(true);
  });

  it('preserves the original error as `cause` for debugging', () => {
    const cause = new Error('root cause');
    expect(toSentinelError(cause).cause).toBe(cause);
  });
});
