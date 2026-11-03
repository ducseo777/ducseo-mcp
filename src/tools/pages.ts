import { z } from 'zod';
import { seg } from '../client';
import { createContent, updateContent } from './content';
import { DESTRUCTIVE, READ, ToolError, WRITE, defineTool, idArg, localeArg, publishArg, seoArgs, versionArg, type ToolContext } from './define';

const block = z.object({
  id: z.string().describe('Unique within the page (letters, digits, - or _). Keep existing ids when editing.'),
  type: z.string().describe('Block type from list_block_types, e.g. "hero", "richText", "faq".'),
  variant: z.string().optional().describe("One of the block type's variants; omit for the design's default."),
  background: z.string().optional().describe('Section background (see list_block_types rules).'),
  spacing: z.string().optional().describe('Vertical spacing.'),
  data: z.record(z.string(), z.unknown()).describe("Object matching the block type's dataSchema."),
});

const blocks = z
  .array(block)
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
    slug: z.string().optional().describe('URL slug in this language, e.g. "about-us". Derived from the title if omitted (ASCII titles only). Not needed for the home page.'),
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
    "Replace the block list of one language of a page (send the complete list in order: blocks you leave out are removed). Keep the ids of blocks you keep. To change, add or remove a single block use update_page_block, add_page_block or remove_page_block instead. To change only the title or SEO fields, use upsert_translation. Saved as a draft unless publish=true.",
  requires: ['content.write'],
  capability: 'pages',
  input: { id: idArg('page'), locale: localeArg, blocks, version: versionArg, publish: publishArg },
  annotations: WRITE,
  run: ({ id, locale, blocks, version, publish }, ctx) => updateContent(ctx, 'page', id, { locale, version, publish, shared: {}, tr: { blocks } }),
});

// --- One block at a time -----------------------------------------------------------
// The site stores a page language's blocks as one list. These tools read the current list
// (the draft if there is one), change one block and save the whole list with the version they
// read, so a small edit does not make the agent resend a long page and a concurrent edit is
// never overwritten.

type Block = z.infer<typeof block>;
type PageState = { version: number; doc: { translations: Record<string, { blocks?: Block[] }> } };

const blockIdArg = z.string().describe('The block id, as listed by get_page.');

async function editBlocks(
  ctx: ToolContext,
  input: { id: string; locale?: string; version?: number; publish?: boolean },
  edit: (blocks: Block[]) => Block[],
) {
  const locale = ctx.locale(input.locale);
  const page = await ctx.client.get<PageState>(`/pages/${seg(input.id)}`);
  const tr = page.doc.translations[locale];
  if (!tr) {
    throw new ToolError(
      `This page has no "${locale}" version yet. Create it with upsert_translation (type "page"), or work in one of: ${Object.keys(page.doc.translations).join(', ')}.`,
    );
  }
  if (input.version !== undefined && input.version !== page.version) {
    throw new ToolError(`The page is at version ${page.version}, not ${input.version}: someone changed it since you read it. Call get_page again and retry.`);
  }
  const next = edit(structuredClone(tr.blocks ?? []));
  return updateContent(ctx, 'page', input.id, { locale, version: page.version, publish: input.publish, shared: {}, tr: { blocks: next } });
}

function indexOf(blocks: Block[], blockId: string): number {
  const i = blocks.findIndex((b) => b.id === blockId);
  if (i < 0) throw new ToolError(`No block "${blockId}" in this language. Blocks: ${blocks.map((b) => `${b.id} (${b.type})`).join(', ') || 'none'}.`);
  return i;
}

const positionArgs = {
  after: z.string().optional().describe('Put the block right after the block with this id.'),
  first: z.boolean().optional().describe('Put the block first on the page (a hero must stay first if the page has one).'),
};

function place(blocks: Block[], b: Block, where: { after?: string; first?: boolean }): Block[] {
  if (where.first) return [b, ...blocks];
  if (where.after) {
    const i = indexOf(blocks, where.after);
    return [...blocks.slice(0, i + 1), b, ...blocks.slice(i + 1)];
  }
  return [...blocks, b];
}

export const updatePageBlock = defineTool({
  name: 'update_page_block',
  title: 'Change one page block',
  description:
    "Change one block of one language of a page without resending the others. `data` is merged into the block's data: keys you pass replace the old values (arrays such as FAQ items or plans are replaced as a whole), keys set to null are removed, keys you leave out stay. " +
    'It can also change variant, background or spacing (null = back to the default) and move the block (after / first). Prefer this over update_page_blocks for a single block. Saved as a draft unless publish=true.',
  requires: ['content.write'],
  capability: 'pages',
  input: {
    id: idArg('page'),
    blockId: blockIdArg,
    locale: localeArg,
    data: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Fields of the block data to set, e.g. {"image": "<media id>"} or {"title": "New title"}.'),
    replaceData: z.boolean().optional().describe('true: `data` replaces the whole data object instead of being merged into it.'),
    variant: z.string().nullable().optional().describe("One of the block type's variants; null = the design's default."),
    background: z.string().nullable().optional().describe('canvas, soft, dark or brand; null = the block default.'),
    spacing: z.string().nullable().optional().describe('compact, normal or spacious; null = normal.'),
    ...positionArgs,
    version: versionArg,
    publish: publishArg,
  },
  annotations: WRITE,
  run: ({ id, blockId, locale, data, replaceData, variant, background, spacing, after, first, version, publish }, ctx) =>
    editBlocks(ctx, { id, locale, version, publish }, (blocks) => {
      const i = indexOf(blocks, blockId);
      const b: Block = { ...blocks[i]! };
      if (data) {
        const merged: Record<string, unknown> = replaceData ? {} : { ...b.data };
        for (const [k, v] of Object.entries(data)) {
          if (v === null) delete merged[k];
          else merged[k] = v;
        }
        b.data = merged;
      }
      for (const [k, v] of [
        ['variant', variant],
        ['background', background],
        ['spacing', spacing],
      ] as const) {
        if (v === null) delete b[k];
        else if (v !== undefined) b[k] = v;
      }
      if (after === undefined && !first) return blocks.map((x, j) => (j === i ? b : x));
      return place(
        blocks.filter((_, j) => j !== i),
        b,
        { after, first },
      );
    }),
});

export const addPageBlock = defineTool({
  name: 'add_page_block',
  title: 'Add a page block',
  description:
    'Insert one new block into one language of a page: after a given block, first, or (by default) at the end. Read list_block_types for the data schema first; the id must be new on the page. Saved as a draft unless publish=true.',
  requires: ['content.write'],
  capability: 'pages',
  input: { id: idArg('page'), locale: localeArg, block, ...positionArgs, version: versionArg, publish: publishArg },
  annotations: WRITE,
  run: ({ id, locale, block: b, after, first, version, publish }, ctx) =>
    editBlocks(ctx, { id, locale, version, publish }, (blocks) => {
      if (blocks.some((x) => x.id === b.id)) {
        throw new ToolError(`A block with id "${b.id}" already exists on this page. Choose another id, or use update_page_block to change it.`);
      }
      return place(blocks, b, { after, first });
    }),
});

export const removePageBlock = defineTool({
  name: 'remove_page_block',
  title: 'Remove a page block',
  description: 'Remove one block from one language of a page; the other blocks stay as they are. The revision history keeps the old version. Saved as a draft unless publish=true.',
  requires: ['content.write'],
  capability: 'pages',
  input: { id: idArg('page'), blockId: blockIdArg, locale: localeArg, version: versionArg, publish: publishArg },
  annotations: DESTRUCTIVE,
  run: ({ id, blockId, locale, version, publish }, ctx) =>
    editBlocks(ctx, { id, locale, version, publish }, (blocks) => {
      const i = indexOf(blocks, blockId);
      return blocks.filter((_, j) => j !== i);
    }),
});

export const pageTools = [listBlockTypes, listPages, getPage, createPage, updatePageBlocks, updatePageBlock, addPageBlock, removePageBlock];
