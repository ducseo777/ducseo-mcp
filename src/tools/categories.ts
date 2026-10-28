import { z } from 'zod';
import { seg } from '../client';
import { createContent, deleteContent, updateContent } from './content';
import { DESTRUCTIVE, READ, WRITE, defineTool, faqArg, idArg, localeArg, markdownNote, publishArg, seoArgs, versionArg } from './define';

const translationFields = {
  name: z.string().describe('Category name as buyers search for it, e.g. "Ball Valves".'),
  slug: z.string().optional().describe('URL slug in this language. Derived from the name if omitted (ASCII names only). URL: /products/{slug}/.'),
  intro: z.string().optional().describe(`Short intro above the product grid, 1–3 sentences. ${markdownNote}`),
  body: z.string().optional().describe(`Long SEO copy below the products (selection guide, materials, standards, applications), typically 300–800 words. ${markdownNote}`),
  faq: faqArg.optional(),
  facts: z
    .array(z.object({ label: z.string(), value: z.string() }))
    .max(8)
    .optional()
    .describe('Two to six key figures for the range shown beside the title, e.g. {"label": "Sizes", "value": "DN15–DN600"}.'),
  ...seoArgs,
};

const sharedFields = {
  parentId: z.string().nullable().optional().describe('Parent category id for a subcategory; null for a top-level category. Keep trees at most 3 levels deep.'),
  coverMediaId: z.string().nullable().optional().describe('Cover image media id.'),
  showInNav: z.boolean().optional().describe('Show in the Products menu dropdown (default true).'),
  sort: z.number().int().min(0).optional().describe('Lower numbers first.'),
};

const split = (args: Record<string, unknown>) => {
  const shared: Record<string, unknown> = {};
  const tr: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (k in sharedFields) shared[k] = v;
    else if (k in translationFields) tr[k] = v;
  }
  return { shared, tr };
};

export const listCategories = defineTool({
  name: 'list_categories',
  title: 'List categories',
  description: 'All product categories (flat list with parentId) with name and slug in the chosen language, languages present, product count and status.',
  requires: ['content.read'],
  input: { locale: localeArg },
  annotations: READ,
  run: ({ locale }, ctx) => ctx.client.get('/categories', { locale: ctx.locale(locale) }),
});

export const getCategory = defineTool({
  name: 'get_category',
  title: 'Get category',
  description: 'Full category with every language (pending draft if any), status and version.',
  requires: ['content.read'],
  input: { id: idArg('category') },
  annotations: READ,
  run: ({ id }, ctx) => ctx.client.get(`/categories/${seg(id)}`),
});

export const createCategory = defineTool({
  name: 'create_category',
  title: 'Create category',
  description: 'Create a product category in one language. Category pages rank for broad terms, so give them intro, body and FAQ copy. Saved as a draft unless publish=true.',
  requires: ['content.write'],
  input: { locale: localeArg, ...translationFields, ...sharedFields, publish: publishArg },
  annotations: WRITE,
  run: ({ locale, publish, ...rest }, ctx) => createContent(ctx, 'category', { locale, publish, nameField: 'name', ...split(rest) }),
});

export const updateCategory = defineTool({
  name: 'update_category',
  title: 'Update category',
  description:
    'Change some fields of a category, including its SEO copy (intro, body, FAQ, meta). Language fields change only in `locale`; lists you pass replace the old ones. Saved as a draft unless publish=true.',
  requires: ['content.write'],
  input: { id: idArg('category'), locale: localeArg, ...z.object(translationFields).partial().shape, ...sharedFields, version: versionArg, publish: publishArg },
  annotations: WRITE,
  run: ({ id, locale, version, publish, ...rest }, ctx) => updateContent(ctx, 'category', id, { locale, version, publish, ...split(rest) }),
});

export const deleteCategory = defineTool({
  name: 'delete_category',
  title: 'Delete category',
  description: 'Move a category to the trash. Refused while it has subcategories; its products stay but lose the link. Ask the user first.',
  requires: ['content.write'],
  input: { id: idArg('category') },
  annotations: DESTRUCTIVE,
  run: ({ id }, ctx) => deleteContent(ctx, 'category', id),
});

export const categoryTools = [listCategories, getCategory, createCategory, updateCategory, deleteCategory];
