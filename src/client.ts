import type { Config } from './config';
import { describeProxy } from './proxy';

/** An error from the site (`{ error: { code, message, details } }`) or from reaching it. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

type Query = Record<string, string | number | boolean | undefined | null>;
type RequestOptions = { query?: Query; body?: unknown; form?: FormData; timeoutMs?: number };

const DEFAULT_TIMEOUT = 60_000;
/** Waits before the 2nd and 3rd attempt after a network failure. */
const RETRY_DELAYS = [600, 2000];
/** Methods that may be sent twice: repeating them leaves the site in the same state. */
const IDEMPOTENT = new Set(['GET', 'HEAD', 'PUT', 'PATCH', 'DELETE']);
/** Failures while connecting: the request never reached the site, so even a POST can be resent. */
const CONNECT_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'PROXY_CONNECT']);

/** The system error code behind a failed fetch ("fetch failed" hides it in `cause`). */
function errorCode(err: unknown): string | undefined {
  for (let e = err as { code?: unknown; cause?: unknown } | undefined, depth = 0; e && depth < 4; e = e.cause as typeof e, depth++) {
    if (typeof e.code === 'string') return e.code;
  }
  return undefined;
}

function errorText(err: unknown): string {
  const parts: string[] = [];
  for (let e = err as { message?: unknown; cause?: unknown } | undefined, depth = 0; e && depth < 4; e = e.cause as typeof e, depth++) {
    if (typeof e.message === 'string' && e.message && !parts.includes(e.message)) parts.push(e.message);
  }
  return parts.join(': ') || String(err);
}

export type ClientOptions = { retryDelays?: number[]; proxy?: URL };

/** Thin client for /api/agent/v1. Requests only ever go to the configured site (CLAUDE.md §7). */
export class DucseoClient {
  readonly base: string;

  private readonly retryDelays: number[];
  private readonly proxy?: URL;

  constructor(
    private readonly config: Config,
    private readonly fetchImpl: typeof fetch = fetch,
    options: ClientOptions = {},
  ) {
    this.base = `${config.siteUrl}/api/agent/v1`;
    this.retryDelays = options.retryDelays ?? RETRY_DELAYS;
    this.proxy = options.proxy;
  }

  get<T>(path: string, query?: Query) {
    return this.request<T>('GET', path, { query });
  }
  post<T>(path: string, body?: unknown) {
    return this.request<T>('POST', path, { body });
  }
  put<T>(path: string, body: unknown) {
    return this.request<T>('PUT', path, { body });
  }
  patch<T>(path: string, body: unknown) {
    return this.request<T>('PATCH', path, { body });
  }
  delete<T>(path: string) {
    return this.request<T>('DELETE', path);
  }
  upload<T>(path: string, form: FormData) {
    return this.request<T>('POST', path, { form, timeoutMs: 180_000 });
  }

  async request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    const url = this.url(path, opts.query);
    const headers: Record<string, string> = { authorization: `Bearer ${this.config.apiKey}`, accept: 'application/json' };
    let body: RequestInit['body'];
    if (opts.form) body = opts.form;
    else if (opts.body !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }

    const res = await this.send(method, url, { method, headers, body }, opts.timeoutMs ?? DEFAULT_TIMEOUT);

    if (res.status === 204) return null as T;
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      // not JSON (e.g. a proxy or Cloudflare error page)
    }
    if (!res.ok) {
      const e = (data as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
      if (e?.code) throw new ApiError(res.status, e.code, e.message ?? 'Request failed.', e.details);
      throw new ApiError(
        res.status,
        'http_error',
        `${this.config.siteUrl} answered HTTP ${res.status} without a Ducseo error body. Is DUCSEO_SITE_URL the Ducseo site, and is it online?`,
      );
    }
    if (data === null && text) {
      throw new ApiError(res.status, 'bad_response', `${this.config.siteUrl} returned something that is not JSON. Is DUCSEO_SITE_URL the Ducseo site?`);
    }
    return data as T;
  }

  /**
   * fetch with retries for flaky networks (resets on the way to Cloudflare are common from
   * mainland China). Idempotent requests are retried on any network failure; a POST only when the
   * connection itself failed, so a create is never sent twice. Timeouts are not retried.
   */
  private async send(method: string, url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      } catch (err) {
        const timedOut = err instanceof Error && err.name === 'TimeoutError';
        const code = errorCode(err);
        const connectFailed = (code !== undefined && CONNECT_CODES.has(code)) || /before secure TLS connection/i.test(errorText(err));
        if (!timedOut && attempt < this.retryDelays.length && (IDEMPOTENT.has(method) || connectFailed)) {
          await new Promise((r) => setTimeout(r, this.retryDelays[attempt]));
          continue;
        }
        const reason = timedOut ? 'the request timed out' : `${errorText(err)}${code ? ` [${code}]` : ''}`;
        const tries = attempt + 1 > 1 ? ` after ${attempt + 1} attempts` : '';
        const hint = this.proxy
          ? `Requests go through the proxy ${describeProxy(this.proxy)}; check that it is running.`
          : 'If this keeps happening (for example in mainland China, where connections to Cloudflare are often reset), the user can set DUCSEO_PROXY to the HTTP address of their proxy app, e.g. "http://127.0.0.1:7890", in this MCP server env and restart the AI tool.';
        const sent = method === 'POST' && !connectFailed && !timedOut ? ' The request may have reached the site: list or get the item before creating it again.' : '';
        throw new ApiError(0, 'network_error', `Could not reach ${this.config.siteUrl}${tries} (${reason}).${sent} Check the internet connection, then retry. ${hint}`);
      }
    }
  }

  private url(path: string, query?: Query): string {
    if (!path.startsWith('/') || path.includes('..') || path.includes('//')) throw new Error(`Invalid API path "${path}".`);
    const url = new URL(this.base + path);
    // Defence in depth: never let a crafted path send the key to another host.
    if (url.origin !== this.config.siteUrl) throw new Error('Refusing to send a request outside the configured site.');
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
    return url.toString();
  }
}

/** Path segment for ids and other user-supplied values. */
export const seg = (v: string) => encodeURIComponent(v);
