import { describe, expect, it } from 'vitest';
import { ApiError, DucseoClient } from '../src/client';
import { ConfigError, keyPrefix, loadConfig } from '../src/config';
import { config, mockFetch } from './helpers';

describe('config', () => {
  it('normalises the site URL to its origin', () => {
    expect(loadConfig({ DUCSEO_SITE_URL: 'https://www.example.com/admin/', DUCSEO_API_KEY: 'dsk_live_abcdefgh12' })).toEqual({
      siteUrl: 'https://www.example.com',
      apiKey: 'dsk_live_abcdefgh12',
      locale: undefined,
    });
  });

  it('allows plain http only for a local development site', () => {
    expect(loadConfig({ DUCSEO_SITE_URL: 'http://localhost:4321', DUCSEO_API_KEY: 'dsk_live_abcdefgh12' }).siteUrl).toBe('http://localhost:4321');
    expect(() => loadConfig({ DUCSEO_SITE_URL: 'http://www.example.com', DUCSEO_API_KEY: 'dsk_live_abcdefgh12' })).toThrow(ConfigError);
  });

  it('explains missing or malformed values in English and Chinese without leaking the key', () => {
    expect(() => loadConfig({ DUCSEO_API_KEY: 'dsk_live_abcdefgh12' })).toThrow(/DUCSEO_SITE_URL[\s\S]*没有设置/);
    const err = (() => {
      try {
        loadConfig({ DUCSEO_SITE_URL: 'https://www.example.com', DUCSEO_API_KEY: 'sk-secret-value-that-is-long' });
      } catch (e) {
        return e as Error;
      }
    })();
    expect(err?.message).toContain('dsk_');
    expect(err?.message).not.toContain('secret-value-that-is-long');
    expect(() => loadConfig({ DUCSEO_SITE_URL: 'https://www.example.com', DUCSEO_API_KEY: 'dsk_live_abcdefgh12', DUCSEO_LOCALE: 'Spanish' })).toThrow(/DUCSEO_LOCALE/);
  });

  it('shows only a key prefix', () => {
    expect(keyPrefix('dsk_live_abcdefghijklmnop')).toBe('dsk_live_abc…');
  });
});

describe('client', () => {
  it('sends the bearer key and JSON, and drops empty query values', async () => {
    const m = mockFetch({ json: { ok: true } });
    const client = new DucseoClient(config, m.fetch);
    await client.get('/products', { q: 'valve', status: undefined, page: 2, categoryId: '' });
    expect(m.calls[0]!.url).toBe('https://www.example.com/api/agent/v1/products?q=valve&page=2');
    expect(m.calls[0]!.headers.authorization).toBe(`Bearer ${config.apiKey}`);
  });

  it('turns site errors into ApiError with code, message and details', async () => {
    const m = mockFetch({ status: 422, json: { error: { code: 'validation_failed', message: 'Slug is taken.', details: { field: 'slug' } } } });
    const err = await new DucseoClient(config, m.fetch).post('/products', {}).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 422, code: 'validation_failed', message: 'Slug is taken.', details: { field: 'slug' } });
  });

  it('explains non-Ducseo answers and network failures', async () => {
    const html = mockFetch({ status: 502, text: '<html>Bad gateway</html>' });
    await expect(new DucseoClient(config, html.fetch).get('/whoami')).rejects.toMatchObject({ code: 'http_error' });
    const down = new DucseoClient(config, (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch);
    await expect(down.get('/whoami')).rejects.toMatchObject({ code: 'network_error' });
  });

  it('never sends the key anywhere but the configured site', async () => {
    const m = mockFetch();
    const client = new DucseoClient(config, m.fetch);
    await expect(client.get('//evil.example/steal')).rejects.toThrow();
    await expect(client.get('/../../x')).rejects.toThrow();
    await expect(client.get('@evil.example/x')).rejects.toThrow();
    expect(m.calls).toHaveLength(0);
  });
});
