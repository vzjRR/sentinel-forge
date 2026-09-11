/**
 * Credential strings assembled at runtime for tests.
 *
 * The security tests need values shaped like live credentials, because that is
 * the path a credential detector must be exercised on. Committing such values
 * is a different matter: a repository that contains strings a secret scanner
 * reads as live is a repository that trips push protection, alarms reviewers,
 * and contradicts this product's own commitment that no secret is committed.
 *
 * So the values are built here from fragments. Nothing in the repository reads
 * as a credential, and the tests still get realistic input.
 *
 * Every value produced here is fabricated and authenticates against nothing.
 */

/** Joins fragments so no complete credential-shaped literal exists in source. */
function assemble(...parts: readonly string[]): string {
  return parts.join('');
}

export function fabricatedDiscordWebhook(): string {
  return assemble(
    'https://discord.com/api/',
    'webhooks/',
    '473829104857392017/',
    'hT2mQvXpL9dRfWs4KcYbNjE7',
    'uZaG3iOx5PtVnMwB6lSrDkAq',
  );
}

export function fabricatedApiKey(): string {
  // Deliberately not in any vendor's published key format: the detector matches
  // the assignment shape and the value's properties, not a vendor prefix.
  return assemble('7Kd93MzQ', 'pXvR2NwL', '5tYbHcJ8', 'rT4mQ9vL');
}

export function fabricatedPassword(): string {
  return assemble('r4T#mQ', '9vLp2Wx');
}

export function fabricatedDatabaseUri(): string {
  return assemble('mysql://sf_service:', '8Jd2kQpV9mXr', '@db.invalid:3306/sf_records');
}

export function fabricatedJwt(): string {
  return assemble(
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
    '.',
    'eyJzdWIiOiI0NzM4MjkxMDQ4NTczOTIwIn0',
    '.',
    'Kd93MzQpXvR2NwL5tYbHcJ8rT4mQ9vLp2Wx',
  );
}

/** Every fabricated value, for leak assertions. */
export function allFabricatedSecrets(): string[] {
  return [
    fabricatedDiscordWebhook().split('/').pop() ?? '',
    fabricatedApiKey(),
    fabricatedPassword(),
    '8Jd2kQpV9mXr',
    fabricatedJwt(),
  ].filter((value) => value.length > 0);
}

/**
 * A resource whose files contain realistically shaped fabricated credentials.
 * Written into a temporary server tree by the tests that need the
 * high-confidence detection path.
 */
export function fabricatedLeakyResource(): Record<string, string> {
  return {
    'fxmanifest.lua': [
      "fx_version 'cerulean'",
      "game 'gta5'",
      '',
      "description 'Generated at test time. Contains fabricated credentials.'",
      "version '1.0.0'",
      '',
      "server_script 'server.lua'",
      '',
    ].join('\n'),
    'server.lua': [
      '-- Generated at test time. Every value below is fabricated and',
      '-- authenticates against nothing.',
      '',
      `local hook = '${fabricatedDiscordWebhook()}'`,
      '',
      'local settings = {',
      `    api_key = '${fabricatedApiKey()}',`,
      `    password = '${fabricatedPassword()}',`,
      '}',
      '',
      `local connection = '${fabricatedDatabaseUri()}'`,
      '',
      `local Authorization = 'Bearer ${fabricatedJwt()}'`,
      '',
      "RegisterNetEvent('sf_leaky:report', function(message)",
      "    PerformHttpRequest(hook, function() end, 'POST', json.encode({ content = message }))",
      'end)',
      '',
    ].join('\n'),
  };
}
