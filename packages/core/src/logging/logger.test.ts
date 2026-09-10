import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger, createSilentLogger } from './logger.js';

function captureStream(): { stream: Writable; lines: () => string[] } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer | string, _encoding, callback): void {
      chunks.push(chunk.toString());
      callback();
    },
  });
  return { stream, lines: () => chunks.join('').split('\n').filter((line) => line.length > 0) };
}

const fixedNow = (): Date => new Date('2026-01-01T00:00:00.000Z');

describe('structured logger', () => {
  it('emits one JSON object per line in json format', () => {
    const { stream, lines } = captureStream();
    const logger = createLogger({ stream, format: 'json', now: fixedNow });
    logger.info('Scan started.', { resource: 'sf_core' });

    const parsed = JSON.parse(lines()[0] ?? '{}') as Record<string, unknown>;
    expect(parsed['level']).toBe('INFO');
    expect(parsed['message']).toBe('Scan started.');
    expect(parsed['timestamp']).toBe('2026-01-01T00:00:00.000Z');
    expect(parsed['context']).toEqual({ resource: 'sf_core' });
  });

  it('filters records below the configured level', () => {
    const { stream, lines } = captureStream();
    const logger = createLogger({ stream, level: 'WARN', now: fixedNow });
    logger.debug('debug');
    logger.info('info');
    logger.warn('warn');
    logger.error('error');
    expect(lines()).toHaveLength(2);
  });

  it('writes nothing at SILENT level', () => {
    const { stream, lines } = captureStream();
    const logger = createLogger({ stream, level: 'SILENT', now: fixedNow });
    logger.error('this must not appear');
    expect(lines()).toHaveLength(0);
    expect(createSilentLogger().isLevelEnabled('ERROR')).toBe(false);
  });

  it('merges child context into every record', () => {
    const { stream, lines } = captureStream();
    const logger = createLogger({ stream, format: 'json', now: fixedNow }).child({ scanRun: 'run_1' });
    logger.info('Analyzing.', { resource: 'sf_hud' });

    const parsed = JSON.parse(lines()[0] ?? '{}') as { context: Record<string, unknown> };
    expect(parsed.context).toEqual({ scanRun: 'run_1', resource: 'sf_hud' });
  });

  it('redacts secrets in both the message and the context', () => {
    const { stream, lines } = captureStream();
    const logger = createLogger({ stream, format: 'json', now: fixedNow });
    logger.warn('Found token = "EXAMPLE_FIXTURE_TOKEN_0000" in config', {
      password: 'EXAMPLE_NOT_A_REAL_PASSWORD',
    });

    const line = lines()[0] ?? '';
    expect(line).not.toContain('EXAMPLE_FIXTURE_TOKEN_0000');
    expect(line).not.toContain('EXAMPLE_NOT_A_REAL_PASSWORD');
    expect(line).toContain('********');
  });

  it('renders context as key=value pairs in pretty format', () => {
    const { stream, lines } = captureStream();
    const logger = createLogger({ stream, format: 'pretty', now: fixedNow });
    logger.info('Scan finished.', { findings: 3, resource: 'sf_core' });
    expect(lines()[0]).toBe('2026-01-01T00:00:00.000Z info  Scan finished. findings=3 resource=sf_core');
  });
});
