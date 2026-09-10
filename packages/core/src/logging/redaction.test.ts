import { describe, expect, it } from 'vitest';
import { REDACTION_MASK, containsRedactableSecret, maskSecret, redactText, redactValue } from './redaction.js';

/**
 * Redaction is a security control, not a formatting nicety: Sentinel Forge
 * reads credentials out of resource files, so a leak here would turn a
 * diagnostic tool into a disclosure channel.
 *
 * Every value in this file is a fictional placeholder.
 */
describe('redaction', () => {
  it('redacts Discord webhook tokens while keeping the endpoint recognisable', () => {
    const input = 'local hook = "https://discord.com/api/webhooks/000000000000000000/EXAMPLE_FIXTURE_TOKEN"';
    const output = redactText(input);
    expect(output).not.toContain('EXAMPLE_FIXTURE_TOKEN');
    expect(output).toContain('https://discord.com/api/webhooks/');
    expect(output).toContain(REDACTION_MASK);
  });

  it('redacts discordapp.com and versioned webhook paths', () => {
    const output = redactText('https://discordapp.com/api/v10/webhooks/111111111111111111/EXAMPLE_TOKEN_VALUE');
    expect(output).not.toContain('EXAMPLE_TOKEN_VALUE');
  });

  it('redacts credentials embedded in a connection URI', () => {
    const output = redactText('mysql://fixture_user:EXAMPLE_NOT_A_REAL_PASSWORD@127.0.0.1/fixture_db');
    expect(output).not.toContain('EXAMPLE_NOT_A_REAL_PASSWORD');
    expect(output).toContain('mysql://fixture_user:');
    expect(output).toContain('@127.0.0.1/fixture_db');
  });

  it('redacts assignments to credential-named keys in several syntaxes', () => {
    const cases = [
      `local api_key = 'EXAMPLE_FIXTURE_API_KEY_0000'`,
      `password: "EXAMPLE_NOT_A_REAL_PASSWORD"`,
      `"token" => "EXAMPLE_FIXTURE_TOKEN_0000"`,
      `set sv_licenseKey=EXAMPLE_FIXTURE_LICENSE_KEY`,
      `apiKey = EXAMPLE_FIXTURE_UNQUOTED_KEY`,
    ];
    for (const input of cases) {
      const output = redactText(input);
      expect(output, input).toContain(REDACTION_MASK);
      expect(output, input).not.toMatch(/EXAMPLE_[A-Z_]*(KEY|PASSWORD|TOKEN)[A-Z_0-9]*/);
    }
  });

  it('redacts PEM private key blocks', () => {
    const input = [
      '-----BEGIN RSA PRIVATE KEY-----',
      'RkFLRV9GSVhUVVJFX0tFWV9NQVRFUklBTF9OT1RfUkVBTA==',
      '-----END RSA PRIVATE KEY-----',
    ].join('\n');
    const output = redactText(input);
    expect(output).not.toContain('RkFLRV9GSVhUVVJF');
    expect(output).toContain(REDACTION_MASK);
  });

  it('redacts bearer authorization headers and JWTs', () => {
    expect(redactText('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.ZXhhbXBsZQ.c2lnbmF0dXJl')).toContain(REDACTION_MASK);
    expect(redactText('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.ZXhhbXBsZQ.c2lnbmF0dXJl')).not.toContain('c2lnbmF0dXJl');
  });

  it('leaves ordinary diagnostic content untouched', () => {
    const cases = [
      'resource sf_core: 12 files scanned',
      'client.lua:145 while true do',
      'sha256 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
      'https://example.invalid/docs/getting-started',
      'Wait(0) is not automatically a defect',
    ];
    for (const input of cases) {
      expect(redactText(input), input).toBe(input);
    }
  });

  it('is idempotent, so repeated redaction never loses further information', () => {
    const once = redactText('token = "EXAMPLE_FIXTURE_TOKEN_0000"');
    expect(redactText(once)).toBe(once);
  });

  it('detects whether a string would be altered', () => {
    expect(containsRedactableSecret('password = "EXAMPLE_NOT_A_REAL_PASSWORD"')).toBe(true);
    expect(containsRedactableSecret('resource sf_core loaded')).toBe(false);
  });

  it('masks a known secret without making it recoverable', () => {
    const masked = maskSecret('EXAMPLE_FIXTURE_SECRET_VALUE');
    expect(masked.startsWith('EXAM')).toBe(true);
    expect(masked).not.toContain('FIXTURE_SECRET_VALUE');
    // Short values are masked completely: a 4-character prefix of a 6-character
    // secret would disclose most of it.
    expect(maskSecret('abcdef')).toBe(`a${REDACTION_MASK}`);
  });

  it('deep-redacts structures, masking credential-named keys wholesale', () => {
    const redacted = redactValue({
      resource: 'sf_core',
      password: 'EXAMPLE_NOT_A_REAL_PASSWORD',
      nested: { webhook_url: 'https://discord.com/api/webhooks/000000000000000000/EXAMPLE_TOKEN' },
      list: ['token = "EXAMPLE_FIXTURE_TOKEN_0000"'],
      count: 3,
    });
    const serialized = JSON.stringify(redacted);
    expect(serialized).not.toContain('EXAMPLE_NOT_A_REAL_PASSWORD');
    expect(serialized).not.toContain('EXAMPLE_FIXTURE_TOKEN_0000');
    expect(serialized).not.toContain('EXAMPLE_TOKEN');
    expect(serialized).toContain('sf_core');
    expect(serialized).toContain('3');
  });

  it('handles cyclic structures without throwing', () => {
    const cyclic: Record<string, unknown> = { name: 'sf_core' };
    cyclic['self'] = cyclic;
    expect(() => redactValue(cyclic)).not.toThrow();
    expect(JSON.stringify(redactValue(cyclic))).toContain('[Circular]');
  });
});
