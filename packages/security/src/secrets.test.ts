import { describe, expect, it } from 'vitest';
import { scanSecrets, shannonEntropy, WEBHOOK_KINDS } from './secrets.js';

/**
 * Every value in this file is fabricated and authenticates against nothing.
 *
 * Credential-shaped values are assembled from fragments rather than written as
 * literals: a repository containing strings that a secret scanner reads as live
 * trips push protection and alarms reviewers, and this product's own commitment
 * is that no secret is committed. The detector sees the same input either way.
 */
function assemble(...parts: readonly string[]): string {
  return parts.join('');
}

const WEBHOOK_TOKEN = assemble('hT2mQvXpL9dRfWs4KcYbNjE7', 'uZaG3iOx5PtVnMwB');
const WEBHOOK_URL = assemble('https://discord.com/api/', 'webhooks/', '473829104857392017/', WEBHOOK_TOKEN);
const API_KEY = assemble('7Kd93MzQ', 'pXvR2NwL', '5tYbHcJ8');
const PASSWORD = assemble('r4T#mQ', '9vLp2Wx');
const DB_PASSWORD = assemble('8Jd2kQpV', '9mXr');
const JWT = assemble(
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
  '.',
  'eyJzdWIiOiI0NzM4MjkxMDQ4NTczOTIwIn0',
  '.',
  'Kd93MzQpXvR2NwL5tYbHcJ8rT4',
);

function scan(content: string): ReturnType<typeof scanSecrets> {
  return scanSecrets(content, { filePath: 'resources/sf_test/server.lua' });
}

describe('secret detection', () => {
  it('detects a Discord webhook and reports its position', () => {
    const matches = scan(`local hook = '${WEBHOOK_URL}'`);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.kind).toBe('DISCORD_WEBHOOK');
    expect(matches[0]?.line).toBe(1);
    expect(matches[0]?.confidence).toBeGreaterThan(0.8);
  });

  it('never returns the raw value, in any field', () => {
    // The governing constraint of this module.
    const matches = scan(`local hook = '${WEBHOOK_URL}'`);
    const serialized = JSON.stringify(matches);
    expect(serialized).not.toContain(WEBHOOK_TOKEN);
    expect(matches[0]?.redactedExcerpt).toContain('********');
  });

  it('masks the value so two secrets on one line stay distinguishable', () => {
    const matches = scan(`api_key = '${API_KEY}'`);
    expect(matches[0]?.maskedValue).toMatch(/^.{0,6}\*{8}$/);
  });

  it('detects credentials in a connection URI', () => {
    const matches = scan(`local dsn = 'mysql://sf_service:${DB_PASSWORD}@db.invalid:3306/records'`);
    expect(matches[0]?.kind).toBe('URI_CREDENTIALS');
    expect(JSON.stringify(matches)).not.toContain(DB_PASSWORD);
  });

  it('detects a PEM private key block', () => {
    expect(scan('-----BEGIN RSA PRIVATE KEY-----')[0]?.kind).toBe('PRIVATE_KEY');
  });

  it('detects a JWT and an authorization header', () => {
    expect(scan(`local t = '${JWT}'`).some((match) => match.kind === 'JWT')).toBe(true);
    expect(scan(`Authorization = 'Bearer ${JWT}'`).length).toBeGreaterThan(0);
  });

  it('lowers confidence for a value marked as an example', () => {
    const live = scan(`api_key = '${API_KEY}'`)[0];
    const placeholder = scan(`api_key = 'EXAMPLE_API_KEY_PLACEHOLDER'`)[0];
    expect(placeholder?.confidence).toBeLessThan(live?.confidence ?? 1);
    expect(placeholder?.reasons.some((reason) => reason.includes('placeholder'))).toBe(true);
  });

  it('lowers confidence for a repetitive value', () => {
    const match = scan(`local hook = ${JSON.stringify(assemble('https://discord.com/api/', 'webhooks/', '000000000000000000/', '0'.repeat(22)))}`)[0];
    expect(match?.confidence).toBeLessThan(0.6);
  });

  it('reports one secret once, even where patterns overlap', () => {
    // A Discord webhook is also a generic webhook. Reporting both would double
    // count one problem and make a remediation list wrong.
    const matches = scan(`local hook = '${WEBHOOK_URL}'`);
    expect(matches).toHaveLength(1);
    expect(WEBHOOK_KINDS.has(matches[0]?.kind ?? 'API_KEY')).toBe(true);
  });

  it('does not flag ordinary code', () => {
    const clean = [
      "local resourceName = GetCurrentResourceName()",
      "local hash = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'",
      "TriggerServerEvent('sf:sync', playerId)",
      "local url = 'https://docs.fivem.net/docs/'",
    ].join('\n');
    expect(scan(clean)).toEqual([]);
  });

  it('reports the correct line in a multi-line file', () => {
    const matches = scan(['-- comment', 'local x = 1', `password = '${PASSWORD}'`].join('\n'));
    expect(matches[0]?.line).toBe(3);
  });

  it('bounds the number of matches from a hostile file', () => {
    const flood = Array.from({ length: 500 }, (_value, index) => `api_key = '${API_KEY}${String(index)}'`).join('\n');
    expect(scan(flood).length).toBeLessThanOrEqual(200);
  });

  it('skips a single enormous line rather than scanning it with every pattern', () => {
    const huge = `local blob = '${'a'.repeat(8000)}'`;
    expect(() => scan(huge)).not.toThrow();
  });

  it('computes entropy for use as a secondary signal', () => {
    expect(shannonEntropy('')).toBe(0);
    expect(shannonEntropy('aaaaaaaa')).toBe(0);
    expect(shannonEntropy('aB3$xK9p')).toBeGreaterThan(2.5);
  });

  it('never throws on hostile input', () => {
    for (const content of ['', '\n\n\n', "'".repeat(1000), 'password=', 'https://']) {
      expect(() => scan(content)).not.toThrow();
    }
  });
});
