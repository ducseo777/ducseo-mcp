import { z } from 'zod';
import { READ, WRITE, defineTool } from './define';

export const listRedirects = defineTool({
  name: 'list_redirects',
  title: 'List redirects',
  description: 'All 301/302 redirects (old path → new target).',
  requires: ['content.read'],
  capability: 'redirects',
  input: {},
  annotations: READ,
  run: (_args, ctx) => ctx.client.get('/redirects'),
});

export const listNotFound = defineTool({
  name: 'list_not_found',
  title: 'List 404s',
  description: 'Paths visitors or crawlers requested that do not exist, with hit counts and last seen time. Use it after a site migration to find old URLs that need a redirect.',
  requires: ['content.read'],
  capability: 'redirects',
  input: {},
  annotations: READ,
  run: (_args, ctx) => ctx.client.get('/not-found'),
});

export const upsertRedirect = defineTool({
  name: 'upsert_redirect',
  title: 'Add or change redirects',
  description:
    'Create or update redirects, one or many at once (up to 500, e.g. a whole old-site migration). An existing redirect from the same path is replaced. Redirect each old URL to its closest new page, not everything to the home page. Takes effect immediately.',
  requires: ['content.publish'],
  capability: 'redirects',
  input: {
    redirects: z
      .array(
        z.object({
          from: z.string().describe('Old path, e.g. "/products/ball-valve.html". Normalised to lowercase.'),
          to: z.string().describe('Target path starting with "/" (e.g. "/product/ball-valve/") or an https:// URL.'),
          statusCode: z.union([z.literal(301), z.literal(302)]).optional().describe('301 permanent (default) or 302 temporary.'),
        }),
      )
      .min(1)
      .max(500),
  },
  annotations: WRITE,
  run: ({ redirects }, ctx) => ctx.client.post('/redirects', redirects),
});

export const seoTools = [listRedirects, listNotFound, upsertRedirect];
