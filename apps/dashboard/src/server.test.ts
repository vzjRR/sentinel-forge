import { describe, expect, it } from 'vitest';
import { isAllowedHostHeader, isLoopbackHost, SECURITY_HEADERS } from './server.js';
import { parsePath } from './routes.js';

describe('isLoopbackHost', () => {
  it('accepts every form of loopback', () => {
    for (const host of ['127.0.0.1', '127.1.2.3', 'localhost', 'LOCALHOST', '::1', '[::1]']) {
      expect(isLoopbackHost(host), host).toBe(true);
    }
  });

  it('rejects an address reachable from the network', () => {
    // 0.0.0.0 is the one that matters: it is the accidental spelling of
    // "expose this to everything", and it must not read as loopback.
    for (const host of ['0.0.0.0', '192.168.1.10', '10.0.0.1', '::', 'example.com']) {
      expect(isLoopbackHost(host), host).toBe(false);
    }
  });
});

describe('isAllowedHostHeader', () => {
  it('accepts the loopback names a browser sends', () => {
    for (const header of ['localhost:7878', '127.0.0.1:7878', 'localhost', '127.0.0.1', '[::1]:7878']) {
      expect(isAllowedHostHeader(header, '127.0.0.1'), header).toBe(true);
    }
  });

  it('accepts the address the server was bound to', () => {
    expect(isAllowedHostHeader('192.168.1.10:7878', '192.168.1.10')).toBe(true);
  });

  it('refuses a name that resolves here but is not ours', () => {
    // This is the DNS-rebinding case: a page on evil.example whose DNS answer
    // points at 127.0.0.1 would otherwise read every page of this dashboard.
    for (const header of ['evil.example', 'evil.example:7878', 'sentinel.attacker.test']) {
      expect(isAllowedHostHeader(header, '127.0.0.1'), header).toBe(false);
    }
  });

  it('refuses a request with no Host header at all', () => {
    expect(isAllowedHostHeader(undefined, '127.0.0.1')).toBe(false);
    expect(isAllowedHostHeader('', '127.0.0.1')).toBe(false);
  });
});

describe('SECURITY_HEADERS', () => {
  it('permits no script, no frame, no form and no outbound request', () => {
    const policy = SECURITY_HEADERS['Content-Security-Policy'] ?? '';
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("form-action 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).not.toContain('script-src');
    expect(SECURITY_HEADERS['X-Content-Type-Options']).toBe('nosniff');
    expect(SECURITY_HEADERS['X-Frame-Options']).toBe('DENY');
    expect(SECURITY_HEADERS['Referrer-Policy']).toBe('no-referrer');
  });

  it('sends no CORS header, so no other origin can read a page', () => {
    for (const name of Object.keys(SECURITY_HEADERS)) {
      expect(name.toLowerCase().startsWith('access-control-')).toBe(false);
    }
  });

  it('forbids caching, so a stale scan cannot be shown with a fresh timestamp', () => {
    expect(SECURITY_HEADERS['Cache-Control']).toBe('no-store');
  });
});

describe('parsePath', () => {
  it('splits an ordinary path', () => {
    expect(parsePath('/')).toEqual([]);
    expect(parsePath('/resources')).toEqual(['resources']);
    expect(parsePath('/resources/sf_core')).toEqual(['resources', 'sf_core']);
    expect(parsePath('/api/resources/sf_core')).toEqual(['api', 'resources', 'sf_core']);
  });

  it('discards the query string and the fragment', () => {
    expect(parsePath('/resources?q=1')).toEqual(['resources']);
    expect(parsePath('/resources#anchor')).toEqual(['resources']);
  });

  it('decodes a resource name that had to be encoded', () => {
    expect(parsePath('/resources/%5Blocal%5D')).toEqual(['resources', '[local]']);
    expect(parsePath('/resources/sf%20shop')).toEqual(['resources', 'sf shop']);
  });

  it('refuses a traversal sequence rather than normalising it', () => {
    // Normalising is where the bugs live. There is no filesystem behind these
    // routes at all, and a path with `..` in it is refused outright.
    expect(parsePath('/resources/../../etc/passwd')).toBeUndefined();
    expect(parsePath('/resources/%2e%2e/%2e%2e/etc/passwd')).toBeUndefined();
    expect(parsePath('/./resources')).toBeUndefined();
  });

  it('refuses a control character or a malformed encoding', () => {
    expect(parsePath('/resources/%00')).toBeUndefined();
    expect(parsePath('/resources/a%0db')).toBeUndefined();
    expect(parsePath('/resources/%zz')).toBeUndefined();
  });

  it('does not decode twice', () => {
    // `%252e` decodes once to `%2e`. A second decode would turn it into `.`,
    // which is exactly how a traversal gets smuggled past a single check.
    expect(parsePath('/resources/%252e%252e')).toEqual(['resources', '%2e%2e']);
  });
});
