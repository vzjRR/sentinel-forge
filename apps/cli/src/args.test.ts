import { describe, expect, it } from 'vitest';
import { SentinelUserError } from '@sentinel-forge/core';
import { parseArgs } from './args.js';

describe('argument parsing', () => {
  it('reads the command and its positionals', () => {
    const parsed = parseArgs(['resource', 'sf_core']);
    expect(parsed.command).toBe('resource');
    expect(parsed.positionals).toEqual(['sf_core']);
  });

  it('returns a null command when nothing was supplied', () => {
    expect(parseArgs([]).command).toBeNull();
  });

  it('accepts both --option value and --option=value', () => {
    expect(parseArgs(['scan', '--server', '/opt/fxserver']).options.server).toBe('/opt/fxserver');
    expect(parseArgs(['scan', '--server=/opt/fxserver']).options.server).toBe('/opt/fxserver');
  });

  it('parses boolean flags and their short aliases', () => {
    const parsed = parseArgs(['scan', '--json', '-q']);
    expect(parsed.options.json).toBe(true);
    expect(parsed.options.quiet).toBe(true);
    expect(parsed.options.verbose).toBe(false);
  });

  it('rejects an unknown option instead of ignoring it', () => {
    expect(() => parseArgs(['scan', '--colour'])).toThrow(SentinelUserError);
    expect(() => parseArgs(['scan', '--colour'])).toThrow(/Unknown option/);
  });

  it('rejects a value given to a boolean flag', () => {
    expect(() => parseArgs(['scan', '--json=yes'])).toThrow(/does not take a value/);
  });

  it('rejects a missing option value', () => {
    expect(() => parseArgs(['scan', '--server'])).toThrow(/requires a value/);
    expect(() => parseArgs(['scan', '--server', '--json'])).toThrow(/requires a value/);
  });

  it('validates --format against the supported formats', () => {
    expect(parseArgs(['report', '--format', 'markdown']).options.format).toBe('markdown');
    expect(() => parseArgs(['report', '--format', 'pdf'])).toThrow(/Unsupported --format/);
  });

  it('treats everything after -- as positional', () => {
    const parsed = parseArgs(['resource', '--', '--not-an-option']);
    expect(parsed.positionals).toEqual(['--not-an-option']);
  });

  it('omits unset options rather than setting them to undefined', () => {
    const parsed = parseArgs(['version']);
    expect(Object.hasOwn(parsed.options, 'server')).toBe(false);
  });
});
