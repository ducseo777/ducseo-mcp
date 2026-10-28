import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALL_TOOLS, instructions, runTool, selectTools } from '../src/server';
import { createProduct, updateProduct } from '../src/tools/products';
import { createPost } from '../src/tools/posts';
import { upsertTranslation } from '../src/tools/translations';
import { listMedia, readUploadFile, uploadMedia } from '../src/tools/media';
import { slugify } from '../src/tools/define';
import { importDesignMd } from '../src/tools/guidance';
import { context, mockFetch, state, whoami } from './helpers';

const names = (scopes: string[], caps?: string[]) => selectTools(whoami(scopes, caps)).map((t) => t.name);
const text = (r: { content: unknown[] }) => (r.content[0] as { text: string }).text;

describe('tool selection', () => {
  it('has unique names', () => {
    const all = ALL_TOOLS.map((t) => t.name);
    expect(new Set(all).size).toBe(all.length);
  });

  it('offers only what the key may do', () => {
    const readOnly = names(['read']);
    expect(readOnly).toContain('get_product');
    expect(readOnly).not.toContain('create_product');
    expect(readOnly).not.toContain('list_inquiries');
    expect(readOnly).not.toContain('publish');

    const drafter = names(['read', 'content:draft']);
    expect(drafter).toContain('create_product');
    expect(drafter).not.toContain('publish');
    expect(drafter).not.toContain('upload_media');

    expect(names(['read', 'content:publish', 'media:write', 'inquiries:read'])).toEqual(expect.arrayContaining(['publish', 'upload_media', 'list_inquiries', 'upsert_redirect']));
    // whoami needs no scope at all.
    expect(names([])).toEqual(['whoami']);
  });

  it('hides tools an older site version has no endpoint for', () => {
    const old = names(['read'], ['settings', 'products', 'categories', 'media']);
    expect(old).not.toContain('get_site_overview');
    expect(old).not.toContain('list_missing_translations');
    expect(old).not.toContain('list_pages');
    expect(old).not.toContain('get_content_guidelines');
    expect(old).not.toContain('run_seo_check');
    expect(old).toContain('list_products');
    expect(names(['read'], ['guidelines', 'seo-check'])).toEqual(expect.arrayContaining(['get_content_guidelines', 'run_seo_check']));
    // Importing a design file is only useful to a key that can change the theme.
    expect(names(['read'])).not.toContain('import_design_md');
    expect(names(['read', 'settings:write'])).toContain('import_design_md');
  });

  it('tells the agent whether it may publish', () => {
    expect(instructions(whoami(['read', 'content:draft']), 'en')).toContain('cannot publish');
    expect(instructions(whoami(['read', 'content:publish']), 'en')).toContain('Publish only when the user explicitly asks');
  });
});

describe('content tools', () => {
  it('create_product puts language fields under translations and derives the slug', async () => {
    const m = mockFetch({ json: state() });
    const res = await runTool(createProduct, { name: '316 Stainless Ball Valve', summary: 'Forged.', sku: 'BV-316', categoryIds: ['C1'] }, context(m.fetch));
    expect(m.calls[0]).toMatchObject({
      method: 'POST',
      url: 'https://www.example.com/api/agent/v1/products',
      body: { doc: { sku: 'BV-316', categoryIds: ['C1'], translations: { en: { name: '316 Stainless Ball Valve', slug: '316-stainless-ball-valve', summary: 'Forged.' } } } },
    });
    const out = JSON.parse(text(res));
    expect(out).toMatchObject({ status: 'draft', liveUrl: null, reviewInDashboard: 'https://www.example.com/admin/products/01J0000000000000000000PROD' });
    expect(out.note).toContain('draft');
  });

  it('asks for a slug when the name cannot be transliterated', async () => {
    const m = mockFetch();
    const res = await runTool(createProduct, { name: '不锈钢球阀' }, context(m.fetch));
    expect(res.isError).toBe(true);
    expect(text(res)).toContain('Pass `slug`');
    expect(m.calls).toHaveLength(0);
  });

  it('update_product sends only what changed, in the requested language', async () => {
    const m = mockFetch({ json: state({ status: 'published', hasDraft: true, doc: { translations: { es: { name: 'Válvula', slug: 'valvula' } } } }) });
    const res = await runTool(updateProduct, { id: 'P1', locale: 'es', metaDescription: 'Válvulas de bola forjadas.', featured: true, version: 4 }, context(m.fetch));
    expect(m.calls[0]).toMatchObject({ method: 'PATCH', url: 'https://www.example.com/api/agent/v1/products/P1', body: { doc: { featured: true, translations: { es: { metaDescription: 'Válvulas de bola forjadas.' } } }, version: 4 } });
    const out = JSON.parse(text(res));
    expect(out.liveUrl).toBe('https://www.example.com/es/product/valvula/');
    expect(out.note).toContain('Visitors still see the previous version');
  });

  it('refuses an update with nothing to change and a language the site does not have', async () => {
    const m = mockFetch();
    expect(text(await runTool(updateProduct, { id: 'P1' }, context(m.fetch)))).toContain('Nothing to change');
    expect((await runTool(updateProduct, { id: 'P1', locale: 'fr', name: 'Vanne' }, context(m.fetch))).isError).toBe(true);
    expect(m.calls).toHaveLength(0);
  });

  it('create_post turns the date into the UTC timestamp the site stores', async () => {
    const m = mockFetch({ json: state({ doc: { translations: { en: { title: 'Guide', slug: 'guide' } } } }) });
    await runTool(createPost, { title: 'How to Choose a Valve', date: '2024-05-31' }, context(m.fetch));
    expect(m.calls[0]!.body).toMatchObject({ doc: { date: Date.UTC(2024, 4, 31), translations: { en: { slug: 'how-to-choose-a-valve' } } } });
  });

  it('upsert_translation derives a slug only for a new language', async () => {
    const m = mockFetch({ json: state() }, { json: state() });
    await runTool(upsertTranslation, { type: 'product', id: 'P1', locale: 'es', fields: { name: 'Válvula de bola' } }, context(m.fetch));
    expect(m.calls.map((c) => c.method)).toEqual(['GET', 'PATCH']);
    expect(m.calls[1]!.body).toEqual({ doc: { translations: { es: { name: 'Válvula de bola', slug: 'valvula-de-bola' } } } });

    const existing = mockFetch({ json: state({ doc: { translations: { es: { name: 'X', slug: 'x' } } } }) }, { json: state() });
    await runTool(upsertTranslation, { type: 'product', id: 'P1', locale: 'es', fields: { name: 'Válvula' } }, context(existing.fetch));
    expect(existing.calls[1]!.body).toEqual({ doc: { translations: { es: { name: 'Válvula' } } } });
  });

  it('passes site errors through with a hint the agent can act on', async () => {
    const m = mockFetch({ status: 409, json: { error: { code: 'version_conflict', message: 'Changed by Owner.', details: { currentVersion: 7 } } } });
    const res = await runTool(updateProduct, { id: 'P1', name: 'X', version: 3 }, context(m.fetch));
    expect(res.isError).toBe(true);
    expect(text(res)).toMatch(/version_conflict \(HTTP 409\): Changed by Owner\.[\s\S]*currentVersion[\s\S]*get_\* tool again/);
  });
});

describe('media', () => {
  it('uploads one accepted local file as multipart with alt text', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ducseo-'));
    const file = join(dir, 'valve.JPG');
    await writeFile(file, Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
    const m = mockFetch({ json: { id: 'M1' } });
    const res = await runTool(uploadMedia, { path: file, alt: { en: 'Ball valve' } }, context(m.fetch));
    expect(res.isError).toBeFalsy();
    const form = m.calls[0]!.body as FormData;
    expect((form.get('file') as File).name).toBe('valve.JPG');
    expect((form.get('file') as File).type).toBe('image/jpeg');
    expect(form.get('alt')).toBe('{"en":"Ball valve"}');
  });

  it('refuses directories, unknown types and missing files before uploading', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ducseo-'));
    await writeFile(join(dir, 'logo.svg'), '<svg/>');
    await expect(readUploadFile(join(dir, 'logo.svg'))).rejects.toThrow(/not an accepted file type/);
    await expect(readUploadFile(join(dir, 'nope.png'))).rejects.toThrow(/File not found/);
    const folder = join(dir, 'pics.png');
    await mkdtemp(folder);
    await expect(readUploadFile(`${folder}`)).rejects.toThrow();
  });

  it('only filters by missing alt text when the site supports it', async () => {
    const m = mockFetch({ json: { items: [], total: 0, page: 1, pageSize: 40 } });
    await runTool(listMedia, { missingAlt: true }, context(m.fetch));
    expect(m.calls[0]!.url).toContain('missingAlt=1');
    const old = await runTool(listMedia, { missingAlt: true }, context(m.fetch, whoami(['read'], ['media'])));
    expect(text(old)).toContain('cannot filter by missing alt');
  });
});

describe('import_design_md', () => {
  it('returns the file with the mapping rules, the designs and the current theme', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ducseo-'));
    const file = join(dir, 'DESIGN.md');
    await writeFile(file, '# Acme\n\nPrimary: #635bff\n');
    const m = mockFetch({ json: { designs: [{ id: 'industrial' }] } }, { json: { theme: { design: 'oem' }, version: 3 } });
    const res = await runTool(importDesignMd, { path: file }, context(m.fetch));
    const out = JSON.parse(text(res));
    expect(out.designMd).toContain('#635bff');
    expect(out.rules.join(' ')).toContain('never copy');
    expect(out.designsAndFonts.designs[0].id).toBe('industrial');
    expect(out.currentTheme.version).toBe(3);
    expect(m.calls.map((c) => c.url)).toEqual(['https://www.example.com/api/agent/v1/theme/presets', 'https://www.example.com/api/agent/v1/theme']);
  });

  it('only reads Markdown files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ducseo-'));
    await writeFile(join(dir, 'secrets.env'), 'X=1');
    const res = await runTool(importDesignMd, { path: join(dir, 'secrets.env') }, context(mockFetch().fetch));
    expect(text(res)).toContain('not a Markdown file');
  });
});

describe('slugify', () => {
  it('makes ASCII slugs from Latin text', () => {
    expect(slugify('Válvula de Bola & Accesorios (DN50)')).toBe('valvula-de-bola-and-accesorios-dn50');
  });
});
