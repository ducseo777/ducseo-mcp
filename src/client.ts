import type { Config } from './config';

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

/** Thin client for /api/agent/v1. Requests only ever go to the configured site (CLAUDE.md §7). */
export class DucseoClient {
  readonly base: string;

  constructor(
    private readonly config: Config,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.base = `${config.siteUrl}/api/agent/v1`;
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

    let res: Response;
    try {
      res = await this.fetchImpl(url, { method, headers, body, signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT) });
    } catch (err) {
      const reason = err instanceof Error ? (err.name === 'TimeoutError' ? 'the request timed out' : err.message) : String(err);
      throw new ApiError(0, 'network_error', `Could not reach ${this.config.siteUrl} (${reason}). Check the site address and the internet connection, then retry.`);
    }

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
