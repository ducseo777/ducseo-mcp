import { z } from 'zod';
import { seg } from '../client';
import { createContent, deleteContent, updateContent } from './content';
import { DESTRUCTIVE, READ, WRITE, defineTool, faqArg, idArg, localeArg, markdownNote, pageArgs, paging, publishArg, seoArgs, versionArg } from './define';

const specs = z
  .array(
    z.object({
      group: z.string().optional().describe('Optional group heading, e.g. "Dimensions" or "Materials".'),
      rows: z.array(z.object({ label: z.string(), value: z.string() })).describe('Ordered rows, e.g. {"label": "Nominal size", "value": "DN15–DN100"}.'),
    }),
  )
  .describe('Specification table, shown as a table and read by AI search. Values with units; one fact per row.');

const trade = z
  .object({
    moq: z.string().optional().describe('Minimum order quantity, e.g. "500 pcs".'),
    leadTime: z.string().optional().describe('e.g. "25–30 days after deposit".'),
    packaging: z.string().optional(),
    origin: z.string().optional().describe('Place of origin, e.g. "Wenzhou, China".'),
    certifications: z.string().optional().describe('Only certificates the company really holds.'),
    port: z.string().optional().describe('Port of loading, e.g. "Ningbo / Shanghai".'),
    payment: z.string().optional().describe('Payment terms, e.g. "T/T, L/C".'),
    price: z.string().optional().describe('Shown only when showPrice is true. B2B sites usually leave prices out.'),
  })
  .describe('Trade terms buyers compare. When updating, pass the whole object: it replaces the previous trade terms of this language.');

const translationFields = {
  name: z.string().describe('Product name as buyers search for it, e.g. "316 Stainless Steel Flanged Ball Valve".'),
  slug: z.string().optional().describe('URL slug in this language: lowercase, digits, hyphens. Derived from the name if omitted (ASCII names only). URL: /product/{slug}/.'),
  summary: z.string().optional().describe('One or two sentences under the title and in product cards (max 600 characters).'),
  body: z.string().optional().describe(`Product description: features, applications, materials, quality control. ${markdownNote}`),
  specs: specs.optional(),
  trade: trade.optional(),
  faq: faqArg.optional(),
  ...seoArgs,
};

const sharedFields = {
  sku: z.string().nullable().optional().describe('Model number / SKU.'),
  categoryIds: z.array(z.string()).optional().describe('Category ids (list_categories). A product can be in several.'),
  primaryCategoryId: z.string().nullable().optional().describe('Category used for breadcrumbs and structured data; defaults to the first of categoryIds.'),
  mediaIds: z.array(z.string()).optional().describe('Image ids in display order (upload_media first); the first is the main image. 3–6 is ideal. Replaces the gallery.'),
  featured: z.boolean().optional().describe('Show first on the home page and in category lists.'),
  showPrice: z.boolean().optional(),
  videoUrl: z.string().nullable().optional().describe('YouTube URL (https).'),
  pdfMediaId: z.string().nullable().optional().describe('PDF datasheet media id.'),
  relatedIds: z.array(z.string()).optional().describe('Related product ids, shown below the product.'),
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

export const listProducts = defineTool({
  name: 'list_products',
  title: 'List products',
  description: 'Products with id, name, slug, SKU, categories, languages present and status. Filter by search text, category or status. Paginated.',
  requires: ['content.read'],
  input: {
    q: z.string().optional().describe('Search name or SKU.'),
    categoryId: z.string().optional(),
    status: z.enum(['draft', 'published']).optional(),
    locale: localeArg,
    ...pageArgs,
  },
  annotations: READ,
  run: async (args, ctx) => {
    const res = await ctx.client.get<{ items: unknown[]; total: number; page: number; pageSize: number }>('/products', { ...args, locale: ctx.locale(args.locale) });
    return { items: res.items, ...paging(res.total, res.page, res.pageSize) };
  },
});

export const getProduct = defineTool({
  name: 'get_product',
  title: 'Get product',
  description: 'Full product with every language (pending draft if there is one), status and version. Read it before updating so you keep what is already there.',
  requires: ['content.read'],
  input: { id: idArg('product') },
  annotations: READ,
  run: ({ id }, ctx) => ctx.client.get(`/products/${seg(id)}`),
});

export const createProduct = defineTool({
  name: 'create_product',
  title: 'Create product',
  description:
    'Create a product in one language (add other languages later with upsert_translation). Saved as a draft unless publish=true. ' +
    "Use only facts from the user's material; never invent certifications, specs or capacities. Write for overseas B2B buyers in natural target-language wording, not a literal translation.",
  requires: ['content.write'],
  input: { locale: localeArg, ...translationFields, ...sharedFields, publish: publishArg },
  annotations: WRITE,
  run: async ({ locale, publish, ...rest }, ctx) => createContent(ctx, 'product', { locale, publish, nameField: 'name', ...split(rest) }),
});

export const updateProduct = defineTool({
  name: 'update_product',
  title: 'Update product',
  description:
    'Change some fields of a product. Language fields change only in `locale`; fields you leave out keep their value. Lists you pass (specs, faq, mediaIds, categoryIds …) replace the old list, so send the complete list. Saved as a draft unless publish=true.',
  requires: ['content.write'],
  input: { id: idArg('product'), locale: localeArg, ...z.object(translationFields).partial().shape, ...sharedFields, version: versionArg, publish: publishArg },
  annotations: WRITE,
  run: async ({ id, locale, version, publish, ...rest }, ctx) => updateContent(ctx, 'product', id, { locale, version, publish, ...split(rest) }),
});

export const deleteProduct = defineTool({
  name: 'delete_product',
  title: 'Delete product',
  description: 'Move a product to the trash: it disappears from the website and its URL becomes free. Ask the user before deleting.',
  requires: ['content.write'],
  input: { id: idArg('product') },
  annotations: DESTRUCTIVE,
  run: ({ id }, ctx) => deleteContent(ctx, 'product', id),
});

export const productTools = [listProducts, getProduct, createProduct, updateProduct, deleteProduct];
