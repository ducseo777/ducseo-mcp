import { vi } from 'vitest';
import { DucseoClient } from '../src/client';
import type { Config } from '../src/config';
import type { Whoami } from '../src/site';
import type { ToolContext } from '../src/tools/define';

export const config: Config = { siteUrl: 'https://www.example.com', apiKey: 'dsk_live_xxxxxxxxxxxxxxxx' };

export function whoami(scopes: string[] = ['read', 'content:draft'], capabilities?: string[]): Whoami {
  return {
    site: { name: 'Example Co.', url: 'https://www.example.com', version: '0.1.0' },
    api: {
      version: '1.1',
      capabilities: capabilities ?? ['settings', 'locales', 'theme', 'categories', 'products', 'media', 'revisions', 'inquiries', 'pages', 'posts', 'block-types', 'navigation', 'redirects', 'overview', 'missing-translations', 'media-missing-alt'],
    },
    locales: { default: 'en', enabled: ['en', 'es'] },
    key: { name: 'Test', prefix: 'dsk_live_xxxx', scopes, expiresAt: null },
  };
}

type Call = { method: string; url: string; body: unknown; headers: Record<string, string> };

/** A fetch that records calls and answers from a list of responses (JSON bodies). */
export function mockFetch(...responses: { status?: number; json?: unknown; text?: string }[]) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
    calls.push({ method: init?.method ?? 'GET', url: String(url), body, headers: (init?.headers ?? {}) as Record<string, string> });
    const r = responses.shift() ?? { json: {} };
    const text = r.text ?? (r.json === undefined ? '' : JSON.stringify(r.json));
    return new Response(r.status === 204 ? null : text, { status: r.status ?? 200 });
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

export function context(fetchImpl: typeof fetch, site = whoami(), locale?: string): ToolContext {
  const client = new DucseoClient(config, fetchImpl);
  const working = locale ?? site.locales.default;
  return {
    client,
    config,
    site,
    locale: (l) => {
      const v = l ?? working;
      if (!site.locales.enabled.includes(v)) throw new Error(`Language "${v}" is not enabled`);
      return v;
    },
  };
}

export const state = (over: Record<string, unknown> = {}) => ({
  id: '01J0000000000000000000PROD',
  status: 'draft',
  version: 2,
  hasDraft: false,
  sample: false,
  doc: { translations: { en: { name: 'Ball Valve', slug: 'ball-valve' } } },
  ...over,
});
