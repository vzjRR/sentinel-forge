import { describe, expect, it } from 'vitest';
import { displayConfigValue, REDACTED_DISPLAY } from './redact.js';

/** Assembled at runtime so no credential-shaped literal is committed. */
function fabricated(...parts: readonly string[]): string {
  return parts.join('');
}

describe('displayConfigValue', () => {
  it('withholds a value whose key name says it is a credential', () => {
    for (const name of [
      'sv_licenseKey',
      'discord_token',
      'mysql_connection_string',
      'steam_webApiKey',
      'db_password',
    ]) {
      expect(displayConfigValue(name, fabricated('7Kd93MzQ', 'pXvR2NwL', '5tYbHcJ8')), name).toBe(REDACTED_DISPLAY);
    }
  });

  it('withholds a value whose shape is a credential, under any key name', () => {
    // The key name gives nothing away here. The detector has to.
    const value = fabricated('https://discord.com/api/', 'webhooks/', '473829104857392017/', 'hT2mQvXpL9dRfWs4KcYbNjE7uZaG3iOx5PtVnMwB6lSrDkAq');
    expect(displayConfigValue('my_thing', value)).toBe(REDACTED_DISPLAY);
  });

  it('shows an ordinary operational value', () => {
    expect(displayConfigValue('sv_maxclients', '48')).toBe('48');
    expect(displayConfigValue('sv_hostname', 'A Roleplay Server')).toBe('A Roleplay Server');
    expect(displayConfigValue('onesync', 'on')).toBe('on');
    expect(displayConfigValue('sv_scriptHookAllowed', '0')).toBe('0');
  });

  it('leaves an empty value alone rather than reporting it as redacted', () => {
    // An empty value is a real observation about the configuration, and
    // rendering it as "(redacted)" would invent a secret that is not there.
    expect(displayConfigValue('sv_licenseKey', '')).toBe('');
  });

  it('masks a long opaque value even under an unremarkable key name', () => {
    const long = 'a1b2c3d4'.repeat(10);
    const shown = displayConfigValue('unknown_setting', long);
    expect(shown).not.toBe(long);
    expect(shown.startsWith('a1b2c3')).toBe(true);
  });

  it('does not mask a long human-readable value', () => {
    const sentence = 'The best roleplay server in the world, running since 2019 with active staff';
    expect(displayConfigValue('sv_projectDesc', sentence)).toBe(sentence);
  });
});
