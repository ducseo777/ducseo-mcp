import { z } from 'zod';
import { seg } from '../client';
import { CONTENT_PATH } from '../site';
import { READ, WRITE, defineTool, savedSummary, versionArg } from './define';

const contentType = z.enum(['product', 'category', 'page', 'post']).describe('Kind of content.');
type State = Parameters<typeof savedSummary>[2];

export const publish = defineTool({
  name: 'publish',
  title: 'Publish',
  description:
    'Put a product, category, page or post (with its pending draft changes) live on the website. Only when the user asked to publish. It needs a translation in the site default language. Publishing an item whose content did not change keeps its last-modified date.',
  requires: ['content.publish'],
  input: { type: contentType, id: z.string().describe('Id of the item.'), version: versionArg },
  annotations: WRITE,
  run: async ({ type, id, version }, ctx) => {
    const state = await ctx.client.post<State>(`${CONTENT_PATH[type]}/${seg(id)}/publish`, { version });
    return savedSummary(ctx, type, state, ctx.locale());
  },
});

export const listRevisions = defineTool({
  name: 'list_revisions',
  title: 'Version history',
  description: 'Saved versions of an item, newest first: who (person or AI key) did what and when. Use the revision id with revert_revision.',
  requires: ['content.read'],
  capability: 'revisions',
  input: { type: contentType, id: z.string().describe('Id of the item.') },
  annotations: READ,
  run: ({ type, id }, ctx) => ctx.client.get(`${CONTENT_PATH[type]}/${seg(id)}/revisions`),
});

export const revertRevision = defineTool({
  name: 'revert_revision',
  title: 'Restore a version',
  description: 'Bring back an earlier version of an item as a new draft (or live with publish=true). Nothing is lost: the current version stays in the history. Confirm with the user first.',
  requires: ['content.write'],
  capability: 'revisions',
  input: {
    type: contentType,
    id: z.string().describe('Id of the item.'),
    revisionId: z.string().describe('Revision id from list_revisions.'),
    publish: z.boolean().optional().describe('Put the restored version live at once (needs content:publish).'),
  },
  annotations: WRITE,
  run: async ({ type, id, revisionId, publish }, ctx) => {
    const state = await ctx.client.post<State>(`${CONTENT_PATH[type]}/${seg(id)}/revisions/${seg(revisionId)}/revert`, { publish });
    return savedSummary(ctx, type, state, ctx.locale());
  },
});

export const publishTools = [publish, listRevisions, revertRevision];
