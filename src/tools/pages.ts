import { z } from 'zod';
import { seg } from '../client';
import { createContent, updateContent } from './content';
import { READ, WRITE, defineTool, idArg, localeArg, publishArg, seoArgs, versionArg } from './define';

const blocks = z
  .array(
    z.object({
      id: z.string().describe('Unique within the page (letters, digits, - or _). Keep existing ids when editing.'),
      type: z.string().describe('Block type from list_block_types, e.g. "hero", "richText", "faq".'),
      variant: z.string().optional().describe("One of the block type's variants; omit for the design's default."),
      background: z.string().optional().describe('Section background (see list_block_types rules).'),
      spacing: z.string().optional().describe('Vertical spacing.'),
      data: z.record(z.string(), z.unknown()).describe("Object matching the block type's dataSchema."),
    }),
  )
  .describe('The ordered blocks of the page. Call list_block_types first for the types, their data schemas and composition rules.');

export const listBlockTypes = defineTool({
  name: 'list_block_types',
  title: 'Page block types',
  description:
    'Every block type pages can use (hero, rich text, stats, product grids, FAQ, CTA, inquiry form …) with its JSON Schema, variants and the composition rules. Always read this before building or changing page blocks; block types differ between site versions.',
  requires: ['content.read'],
  capability: 'block-types',
  input: {},
  annotations: READ,
  run: (_args, ctx) => ctx.client.get('/block-types'),
});

export const listPages = defineTool({
  name: 'list_pages',
  title: 'List pages',
  description: 'All block-built pages (home page, About, Factory, Certificates, FAQ, legal pages …) with id, kind, title and slug in the chosen language, languages present and status.',
  requires: ['content.read'],
  capability: 'pages',
  input: { locale: localeArg },
  annotations: READ,
  run: ({ locale }, ctx) => ctx.client.get('/pages', { locale: ctx.locale(locale) }),
});

export const getPage = defineTool({
  name: 'get_page',
  title: 'Get page',
  description: 'Full page with every language: title, slug, SEO fields and the block list (pending draft if any), status and version. Read it before changing blocks.',
  requires: ['content.read'],
  capability: 'pages',
  input: { id: idArg('page') },
  annotations: READ,
  run: ({ id }, ctx) => ctx.client.get(`/pages/${seg(id)}`),
});

export const createPage = defineTool({
  name: 'create_page',
  title: 'Create page',
  description:
    'Create a page in one language, optionally with its blocks. kind "home" is the front page (only one); "page" lives at /{slug}/. Facts on About/Factory pages must come from the user. Saved as a draft unless publish=true. Add it to the menu with update_navigation if the user wants.',
  requires: ['content.write'],
  capability: 'pages',
  input: {
    locale: localeArg,
    kind: z.enum(['page', 'home']).optional().describe('Default "page".'),
    title: z.string().describe('Page title (the H1 on most designs).'),
    slug: z.string().optional().describe('URL slug in this language, e.g. "about-us". Derived from the title if omitted (ASCII titles only). Ignored for the home page.'),
    blocks: blocks.optional(),
    ...seoArgs,
    publish: publishArg,
  },
  annotations: WRITE,
  run: ({ locale, kind, publish, ...tr }, ctx) => createContent(ctx, 'page', { locale, publish, nameField: 'title', shared: { kind }, tr }),
});

export const updatePageBlocks = defineTool({
  name: 'update_page_blocks',
  title: 'Replace page blocks',
  description:
    "Replace the block list of one language of a page (send the complete list in order: blocks you leave out are removed). Keep the ids of blocks you keep. To change only the title or SEO fields, use upsert_translation. Saved as a draft unless publish=true.",
  requires: ['content.write'],
  capability: 'pages',
  input: { id: idArg('page'), locale: localeArg, blocks, version: versionArg, publish: publishArg },
  annotations: WRITE,
  run: ({ id, locale, blocks, version, publish }, ctx) => updateContent(ctx, 'page', id, { locale, version, publish, shared: {}, tr: { blocks } }),
});

export const pageTools = [listBlockTypes, listPages, getPage, createPage, updatePageBlocks];
