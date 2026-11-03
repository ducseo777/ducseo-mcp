import { describe, expect, it, vi } from 'vitest';
import { DucseoClient } from '../src/client';
import { loadConfig } from '../src/config';
import { proxyFor } from '../src/proxy';
import { runTool } from '../src/server';
import { addPageBlock, createPage, removePageBlock, updatePageBlock } from '../src/tools/pages';
import { updateNavigation } from '../src/tools/site';
import { config, context, mockFetch, state } from './helpers';

const text = (r: { content: unknown[] }) => (r.content[0] as { text: string }).text;

/** A fetch that fails `failures` times with `err`, then answers {}. */
function flaky(failures: number, err: () => Error) {
  const calls: string[] = [];
  const fn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    calls.push(init?.method ?? 'GET');
    if (calls.length <= failures) throw err();
    return new Response('{}', { status: 200 });
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}
const fetchFailed = (code?: string) => Object.assign(new TypeError('fetch failed'), code ? { cause: Object.assign(new Error(code), { code }) } : {});
const fast = { retryDelays: [0, 0] };

describe('network retries', () => {
  it('retries reads on any network failure', async () => {
    const f = flaky(2, () => fetchFailed('ECONNRESET'));
    await expect(new DucseoClient(config, f.fetch, fast).get('/whoami')).resolves.toEqual({});
    expect(f.calls).toHaveLength(3);
  });

  it('retries a POST only when the connection itself failed', async () => {
    const refused = flaky(1, () => fetchFailed('ECONNREFUSED'));
    await expect(new DucseoClient(config, refused.fetch, fast).post('/pages', {})).resolves.toEqual({});
    expect(refused.calls).toHaveLength(2);

    // A reset after connecting may have delivered the request: never create twice.
    const reset = flaky(1, () => fetchFailed('ECONNRESET'));
    const err = await new DucseoClient(config, reset.fetch, fast).post<never>('/pages', {}).catch((e: Error) => e);
    expect(reset.calls).toHaveLength(1);
    expect(err).toMatchObject({ code: 'network_error' });
    expect(err.message).toContain('[ECONNRESET]');
    expect(err.message).toContain('list or get the item before creating it again');
    expect(err.message).toContain('DUCSEO_PROXY');
  });

  it('treats a reset during the TLS handshake as a failed connection', async () => {
    const f = flaky(1, () => Object.assign(new TypeError('fetch failed'), { cause: new Error('Client network socket disconnected before secure TLS connection was established') }));
    await expect(new DucseoClient(config, f.fetch, fast).post('/media', {})).resolves.toEqual({});
    expect(f.calls).toHaveLength(2);
  });

  it('gives up after three attempts and does not retry timeouts', async () => {
    const down = flaky(9, () => fetchFailed('ENOTFOUND'));
    const err = await new DucseoClient(config, down.fetch, fast).get<never>('/whoami').catch((e: Error) => e);
    expect(down.calls).toHaveLength(3);
    expect(err.message).toContain('after 3 attempts');

    const slow = flaky(9, () => Object.assign(new Error('timed out'), { name: 'TimeoutError' }));
    const t = await new DucseoClient(config, slow.fetch, fast).get<never>('/whoami').catch((e: Error) => e);
    expect(slow.calls).toHaveLength(1);
    expect(t.message).toContain('timed out');
  });
});

describe('proxy configuration', () => {
  const site = 'https://www.example.com';
  it('uses DUCSEO_PROXY, else HTTPS_PROXY / ALL_PROXY unless NO_PROXY matches', () => {
    expect(proxyFor(site, { DUCSEO_PROXY: '127.0.0.1:7890' })?.href).toBe('http://127.0.0.1:7890/');
    expect(proxyFor(site, { HTTPS_PROXY: 'http://127.0.0.1:10809' })?.port).toBe('10809');
    expect(proxyFor(site, { ALL_PROXY: 'http://proxy:8080' })?.hostname).toBe('proxy');
    expect(proxyFor(site, { HTTPS_PROXY: 'http://p:1', NO_PROXY: '.example.com' })).toBeUndefined();
    expect(proxyFor(site, { HTTPS_PROXY: 'socks5://127.0.0.1:1080' })).toBeUndefined();
    expect(proxyFor('http://localhost:4321', { DUCSEO_PROXY: 'http://p:1' })).toBeUndefined();
    expect(proxyFor(site, {})).toBeUndefined();
  });

  it('rejects a DUCSEO_PROXY that is not an HTTP proxy, in both languages', () => {
    const base = { DUCSEO_SITE_URL: 'https://www.example.com', DUCSEO_API_KEY: 'dsk_live_abcdefgh12' };
    expect(() => loadConfig({ ...base, DUCSEO_PROXY: 'socks5://127.0.0.1:1080' })).toThrow(/DUCSEO_PROXY[\s\S]*不支持 SOCKS/);
    expect(loadConfig({ ...base, DUCSEO_PROXY: 'http://127.0.0.1:7890' }).proxy?.host).toBe('127.0.0.1:7890');
  });
});

const page = (blocks: unknown[], version = 5) => ({
  ...state({ id: '01J000000000000000000PAGE1', version, doc: { kind: 'page', translations: { en: { title: 'About', slug: 'about', blocks } } } }),
});
const hero = { id: 'hero', type: 'hero', variant: 'split', data: { title: 'Hi', image: 'OLD' } };
const faq = { id: 'faq', type: 'faq', data: { items: [{ q: 'Q', a: 'A' }] } };

describe('single-block page tools', () => {
  it('merges data into one block and saves the list with the version it read', async () => {
    const m = mockFetch({ json: page([hero, faq]) }, { json: page([]) });
    await runTool(updatePageBlock, { id: 'P1', blockId: 'hero', data: { image: 'NEW', subtitle: null }, variant: null }, context(m.fetch));
    expect(m.calls.map((c) => c.method)).toEqual(['GET', 'PATCH']);
    expect(m.calls[1]!.body).toEqual({
      doc: { translations: { en: { blocks: [{ id: 'hero', type: 'hero', data: { title: 'Hi', image: 'NEW' } }, faq] } } },
      version: 5,
    });
  });

  it('moves, adds and removes single blocks', async () => {
    const move = mockFetch({ json: page([hero, faq, { id: 'cta', type: 'cta', data: {} }]) }, { json: page([]) });
    await runTool(updatePageBlock, { id: 'P1', blockId: 'cta', after: 'hero' }, context(move.fetch));
    expect((move.calls[1]!.body as any).doc.translations.en.blocks.map((b: { id: string }) => b.id)).toEqual(['hero', 'cta', 'faq']);

    const add = mockFetch({ json: page([hero, faq]) }, { json: page([]) });
    await runTool(addPageBlock, { id: 'P1', block: { id: 'stats', type: 'stats', data: { items: [] } }, after: 'hero' }, context(add.fetch));
    expect((add.calls[1]!.body as any).doc.translations.en.blocks.map((b: { id: string }) => b.id)).toEqual(['hero', 'stats', 'faq']);

    const remove = mockFetch({ json: page([hero, faq]) }, { json: page([]) });
    await runTool(removePageBlock, { id: 'P1', blockId: 'faq' }, context(remove.fetch));
    expect((remove.calls[1]!.body as any).doc.translations.en.blocks).toEqual([hero]);
  });

  it('explains unknown blocks, duplicate ids, missing languages and stale versions without saving', async () => {
    const ctx = (r: unknown) => context(mockFetch({ json: r }).fetch);
    expect(text(await runTool(updatePageBlock, { id: 'P1', blockId: 'nope', data: {} }, ctx(page([hero]))))).toContain('Blocks: hero (hero)');
    expect(text(await runTool(addPageBlock, { id: 'P1', block: hero }, ctx(page([hero]))))).toContain('already exists');
    expect(text(await runTool(updatePageBlock, { id: 'P1', blockId: 'hero', locale: 'es', data: {} }, ctx(page([hero]))))).toContain('no "es" version');
    expect(text(await runTool(removePageBlock, { id: 'P1', blockId: 'hero', version: 3 }, ctx(page([hero]))))).toContain('version 5, not 3');
  });

  it('creates a home page with a non-ASCII title without asking for a slug', async () => {
    const m = mockFetch({ json: page([]) });
    const res = await runTool(createPage, { kind: 'home', title: '首页' }, context(m.fetch));
    expect(res.isError).toBeFalsy();
    expect((m.calls[0]!.body as any).doc.translations.en.slug).toBe('home');
  });
});

describe('navigation', () => {
  it('sends the header button and footer column settings', async () => {
    const m = mockFetch({ json: {} });
    await runTool(updateNavigation, { cta: { show: true, label: { en: 'Free consultation' } }, footerProducts: false }, context(m.fetch));
    expect(m.calls[0]).toMatchObject({
      method: 'PATCH',
      url: 'https://www.example.com/api/agent/v1/settings/navigation',
      body: { value: { cta: { show: true, label: { en: 'Free consultation' }, href: '' }, footerProducts: false } },
    });
  });
});
