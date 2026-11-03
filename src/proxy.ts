import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';

// Node's built-in fetch ignores HTTPS_PROXY. In mainland China a direct connection to Cloudflare is
// often reset, so when a proxy is configured every request goes through an HTTP CONNECT tunnel.
// Built on node:http/https/tls only: the MCP has no runtime dependencies (CLAUDE.md §2).

/** The proxy for requests to `siteUrl`: DUCSEO_PROXY, else HTTPS_PROXY / ALL_PROXY, unless NO_PROXY matches. */
export function proxyFor(siteUrl: string, env: NodeJS.ProcessEnv = process.env): URL | undefined {
  const site = new URL(siteUrl);
  if (site.protocol !== 'https:') return undefined; // a local development site
  const raw =
    env.DUCSEO_PROXY?.trim() ||
    (bypassed(site.hostname, env.NO_PROXY ?? env.no_proxy) ? '' : env.HTTPS_PROXY || env.https_proxy || env.ALL_PROXY || env.all_proxy || '').trim();
  if (!raw) return undefined;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : undefined;
  } catch {
    return undefined;
  }
}

function bypassed(host: string, noProxy: string | undefined): boolean {
  if (!noProxy) return false;
  return noProxy
    .split(/[\s,]+/)
    .filter(Boolean)
    .some((entry) => entry === '*' || host === entry.replace(/^\./, '') || host.endsWith(entry.startsWith('.') ? entry : `.${entry}`));
}

/** "http://user:***@127.0.0.1:7890" for logs. */
export function describeProxy(proxy: URL): string {
  return `${proxy.protocol}//${proxy.username ? `${proxy.username}:***@` : ''}${proxy.host}`;
}

/** Error raised while opening the tunnel: nothing has reached the site yet, so a retry is safe. */
export class ProxyConnectError extends Error {
  readonly code = 'PROXY_CONNECT';
}

function openTunnel(proxy: URL, host: string, port: number, signal?: AbortSignal | null): Promise<import('node:net').Socket> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { host: `${host}:${port}` };
    if (proxy.username) {
      headers['proxy-authorization'] = `Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString('base64')}`;
    }
    const mod = proxy.protocol === 'https:' ? https : http;
    const req = mod.request({
      host: proxy.hostname,
      port: Number(proxy.port) || (proxy.protocol === 'https:' ? 443 : 80),
      method: 'CONNECT',
      path: `${host}:${port}`,
      headers,
      signal: signal ?? undefined,
    });
    req.once('connect', (res, socket) => {
      if (res.statusCode === 200) return resolve(socket);
      socket.destroy();
      reject(new ProxyConnectError(`the proxy ${describeProxy(proxy)} refused the connection (HTTP ${res.statusCode})`));
    });
    req.once('error', (err) => reject(signal?.aborted ? signal.reason : new ProxyConnectError(`could not reach the proxy ${describeProxy(proxy)}: ${(err as NodeJS.ErrnoException).code ?? err.message}`)));
    req.end();
  });
}

const NULL_BODY = new Set([101, 204, 205, 304]);

/** A fetch for the client that tunnels through `proxy`. Supports what DucseoClient sends: JSON and multipart. */
export function proxyFetch(proxy: URL): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    const signal = init?.signal ?? null;
    const body = req.body ? Buffer.from(await req.arrayBuffer()) : undefined;
    const headers: Record<string, string> = Object.fromEntries(req.headers);
    if (body) headers['content-length'] = String(body.length);

    const port = Number(url.port) || 443;
    const socket = await openTunnel(proxy, url.hostname, port, signal);
    return new Promise<Response>((resolve, reject) => {
      const r = https.request(
        {
          host: url.hostname,
          port,
          path: url.pathname + url.search,
          method: req.method,
          headers,
          signal: signal ?? undefined,
          createConnection: () => tls.connect({ socket, servername: url.hostname }),
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('error', reject);
          res.on('end', () => {
            const h = new Headers();
            for (const [k, v] of Object.entries(res.headers)) {
              if (v === undefined) continue;
              for (const one of Array.isArray(v) ? v : [v]) h.append(k, one);
            }
            const status = res.statusCode ?? 502;
            resolve(new Response(NULL_BODY.has(status) ? null : Buffer.concat(chunks), { status, headers: h }));
          });
        },
      );
      r.once('error', (err) => {
        socket.destroy();
        reject(signal?.aborted ? signal.reason : err);
      });
      r.end(body);
    });
  }) as typeof fetch;
}
