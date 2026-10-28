import { z } from 'zod';
import { seg } from '../client';
import { createContent, updateContent } from './content';
import { READ, ToolError, WRITE, defineTool, idArg, localeArg, markdownNote, pageArgs, paging, publishArg, seoArgs, versionArg } from './define';

const translationFields = {
  title: z.string().describe('Article title, e.g. "How to Choose a Ball Valve for Water Treatment".'),
  slug: z.string().optional().describe('URL slug in this language (not "page"). Derived from the title if omitted (ASCII titles only). URL: /blog/{slug}/.'),
  excerpt: z.string().optional().describe('One or two sentences for the blog list and link previews (max 600 characters).'),
  body: z.string().optional().describe(`Article body. Answer the question early, then go into detail; buying guides and FAQs work well. ${markdownNote}`),
  ...seoArgs,
};

const sharedFields = {
  coverMediaId: z.string().nullable().optional().describe('Cover image media id.'),
  author: z.string().nullable().optional().describe('Byline; empty = the company.'),
  date: z.string().nullable().optional().describe('Publication date shown to readers, "YYYY-MM-DD" (for articles moved from an old site). Empty = when first published.'),
  relatedProductIds: z.array(z.string()).optional().describe('Products linked at the end of the article.'),
};

const split = (args: Record<string, unknown>) => {
  const shared: Record<string, unknown> = {};
  const tr: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (k === 'date') shared.date = toDate(v as string | null | undefined);
    else if (k in sharedFields) shared[k] = v;
    else if (k in translationFields) tr[k] = v;
  }
  return { shared, tr };
};

/** "YYYY-MM-DD" → UTC ms (the site stores dates as UTC midnight). */
function toDate(v: string | null | undefined): number | null | undefined {
  if (v === undefined || v === null || v === '') return v === '' ? null : v;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new ToolError(`date must look like "2024-05-31" (got "${v}").`);
  return Date.parse(`${v}T00:00:00Z`);
}

export const listPosts = defineTool({
  name: 'list_posts',
  title: 'List blog posts',
  description: 'Blog posts with id, title, slug, author, date, languages present and status. Paginated.',
  requires: ['content.read'],
  input: { q: z.string().optional().describe('Search title or author.'), status: z.enum(['draft', 'published']).optional(), locale: localeArg, ...pageArgs },
  annotations: READ,
  run: async (args, ctx) => {
    const res = await ctx.client.get<{ items: unknown[]; total: number; page: number; pageSize: number }>('/posts', { ...args, locale: ctx.locale(args.locale) });
    return { items: res.items, ...paging(res.total, res.page, res.pageSize) };
  },
});

export const getPost = defineTool({
  name: 'get_post',
  title: 'Get blog post',
  description: 'Full blog post with every language (pending draft if any), status and version.',
  requires: ['content.read'],
  input: { id: idArg('post') },
  annotations: READ,
  run: ({ id }, ctx) => ctx.client.get(`/posts/${seg(id)}`),
});

export const createPost = defineTool({
  name: 'create_post',
  title: 'Create blog post',
  description:
    'Write a blog post in one language. Good topics answer buyer questions (selection guides, comparisons, standards, applications) and link to products. Do not invent customer stories or figures. Saved as a draft unless publish=true.',
  requires: ['content.write'],
  input: { locale: localeArg, ...translationFields, ...sharedFields, publish: publishArg },
  annotations: WRITE,
  run: ({ locale, publish, ...rest }, ctx) => createContent(ctx, 'post', { locale, publish, nameField: 'title', ...split(rest) }),
});

export const updatePost = defineTool({
  name: 'update_post',
  title: 'Update blog post',
  description: 'Change some fields of a blog post. Language fields change only in `locale`. Saved as a draft unless publish=true.',
  requires: ['content.write'],
  input: { id: idArg('post'), locale: localeArg, ...z.object(translationFields).partial().shape, ...sharedFields, version: versionArg, publish: publishArg },
  annotations: WRITE,
  run: ({ id, locale, version, publish, ...rest }, ctx) => updateContent(ctx, 'post', id, { locale, version, publish, ...split(rest) }),
});

export const postTools = [listPosts, getPost, createPost, updatePost];
