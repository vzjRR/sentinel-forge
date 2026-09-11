/**
 * The dashboard HTTP server.
 *
 * Built on `node:http` with no framework, because the product has no
 * third-party runtime dependencies and a router for eleven fixed paths is not
 * worth a supply chain.
 *
 * SECURITY POSTURE
 *
 * This server renders analysis of an untrusted server tree to a browser on the
 * operator's machine. Four decisions follow from that, and each is enforced
 * here rather than left to a view:
 *
 *   1. **Loopback by default.** Binding anywhere else requires an explicit
 *      opt-in, because a dashboard reachable from the network exposes a map of
 *      a server's weaknesses to whoever finds it.
 *   2. **GET and HEAD only.** There is no state to change from a browser. A
 *      request with any other method is refused before routing.
 *   3. **The `Host` header is checked.** Without it, a hostile page could point
 *      a DNS name at 127.0.0.1 and read this dashboard from the browser of
 *      anyone who visits it.
 *   4. **No file is served from disk.** The stylesheet is embedded and there is
 *      no static directory, so there is no path to traverse.
 *
 * © 2026 Talal Al Ghafri. All Rights Reserved.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { isIP } from 'node:net';
import { SentinelSecurityError, type Logger } from '@sentinel-forge/core';
import type { DashboardContext } from './context.js';
import { handleRequest, type RouteResponse } from './routes.js';

/** Addresses that are reachable only from this machine. */
const LOOPBACK_ADDRESSES: ReadonlySet<string> = new Set(['127.0.0.1', '::1', 'localhost']);

/** Host header values accepted in addition to the bound address. */
const ALWAYS_ALLOWED_HOSTNAMES: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export interface DashboardServerOptions {
  readonly context: DashboardContext;
  readonly host: string;
  readonly port: number;
  readonly logger: Logger;
  /**
   * Required to bind anywhere but the loopback interface. Without it, a
   * non-loopback host is refused: the default must be the safe one, and an
   * operator exposing a diagnostic surface should have to say so.
   */
  readonly allowNonLoopback?: boolean;
}

export interface RunningDashboard {
  readonly server: Server;
  readonly host: string;
  readonly port: number;
  readonly url: string;
  close(): Promise<void>;
}

export function isLoopbackHost(host: string): boolean {
  const normalised = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (LOOPBACK_ADDRESSES.has(normalised)) return true;
  // 127.0.0.0/8 is entirely loopback.
  return isIP(normalised) === 4 && normalised.startsWith('127.');
}

/**
 * Decides whether a request's `Host` header may be served.
 *
 * A browser sends the name the user typed. If that name resolves to this
 * machine but is not one we expect, the request is a DNS-rebinding attempt: a
 * page on `evil.example` whose DNS points at 127.0.0.1 would otherwise be able
 * to read every page of this dashboard.
 */
export function isAllowedHostHeader(headerValue: string | undefined, boundHost: string): boolean {
  if (headerValue === undefined) return false;

  // Strip the port. IPv6 literals are bracketed, so the last colon only
  // separates a port when it falls outside the brackets.
  const closingBracket = headerValue.lastIndexOf(']');
  const colon = headerValue.lastIndexOf(':');
  const hostname = (colon > closingBracket && colon !== -1 ? headerValue.slice(0, colon) : headerValue).toLowerCase();

  if (hostname.length === 0) return false;
  if (ALWAYS_ALLOWED_HOSTNAMES.has(hostname)) return true;
  return hostname === boundHost.toLowerCase() || hostname === `[${boundHost.toLowerCase()}]`;
}

/**
 * Headers sent with every response.
 *
 * The content security policy permits inline styles — the stylesheet is
 * embedded — and nothing else. No script, no frame, no form submission, no
 * outbound connection of any kind.
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'Content-Security-Policy':
    "default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'none'; base-uri 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  // The dashboard needs no device capability. Denying them costs nothing and
  // removes a class of surprise if a future page ever embeds something.
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  // Pages describe a live scan; a cached copy would show an operator stale
  // findings with a fresh-looking timestamp.
  'Cache-Control': 'no-store',
});

function send(response: ServerResponse, result: RouteResponse, includeBody: boolean): void {
  const body = Buffer.from(result.body, 'utf8');

  response.writeHead(result.status, {
    ...SECURITY_HEADERS,
    'Content-Type': result.contentType,
    'Content-Length': String(body.byteLength),
    ...(result.headers ?? {}),
  });

  if (includeBody) response.end(body);
  else response.end();
}

/**
 * Starts the dashboard.
 *
 * @throws {SentinelSecurityError} when asked to bind a non-loopback address
 *   without an explicit opt-in.
 */
export async function startDashboard(options: DashboardServerOptions): Promise<RunningDashboard> {
  if (!isLoopbackHost(options.host) && options.allowNonLoopback !== true) {
    throw new SentinelSecurityError(
      `Refusing to bind the dashboard to ${options.host}, which is reachable from outside this machine.`,
      {
        remediation:
          'The dashboard exposes a map of a server\'s weaknesses and has no authentication.\n' +
          'Bind it to 127.0.0.1 (the default), or pass --allow-non-loopback if you have\n' +
          'placed it behind your own authentication and understand the exposure.',
        details: { host: options.host },
      },
    );
  }

  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    // `serve` handles its own failures, but a failure inside that handling —
    // an unusable logger, a socket that died mid-write — would otherwise
    // surface as an unhandled rejection and take the process down. The
    // dashboard stays up and the connection is closed.
    serve(request, response, options).catch(() => {
      if (!response.writableEnded) response.end();
    });
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(options.port, options.host);
  });

  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : options.port;
  const displayHost = options.host.includes(':') ? `[${options.host}]` : options.host;

  return {
    server,
    host: options.host,
    port,
    url: `http://${displayHost}:${String(port)}/`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined || error === null) resolve();
          else reject(error);
        });
        // Keep-alive sockets would hold the process open past close().
        server.closeAllConnections();
      }),
  };
}

async function serve(
  request: IncomingMessage,
  response: ServerResponse,
  options: DashboardServerOptions,
): Promise<void> {
  const method = request.method ?? 'GET';

  try {
    if (method !== 'GET' && method !== 'HEAD') {
      // Nothing here changes state, so anything else is either a mistake or an
      // attempt. Either way it is refused before a route is chosen.
      send(
        response,
        {
          status: 405,
          contentType: 'text/plain; charset=utf-8',
          body: 'The Sentinel Forge dashboard is read-only and accepts GET and HEAD only.\n',
          headers: { Allow: 'GET, HEAD' },
        },
        true,
      );
      return;
    }

    if (!isAllowedHostHeader(request.headers.host, options.host)) {
      options.logger.warn('Dashboard request refused: unexpected Host header.', {
        host: request.headers.host ?? '(absent)',
      });
      send(
        response,
        {
          status: 421,
          contentType: 'text/plain; charset=utf-8',
          body:
            'This request was not addressed to the dashboard.\n' +
            'Open it at the address Sentinel Forge printed when it started.\n',
        },
        true,
      );
      return;
    }

    const result = await handleRequest(request.url ?? '/', options.context);
    send(response, result, method !== 'HEAD');
  } catch (error) {
    // An unexpected failure must not leak a stack trace into a browser: the
    // path of the operator's filesystem is in it.
    options.logger.error('Dashboard request failed.', {
      url: request.url ?? '',
      error: error instanceof Error ? error.message : String(error),
    });

    if (!response.headersSent) {
      send(
        response,
        {
          status: 500,
          contentType: 'text/plain; charset=utf-8',
          body: 'The dashboard could not render this page. The reason was written to the Sentinel Forge log.\n',
        },
        true,
      );
    } else {
      response.end();
    }
  }
}
