import { seg } from '../client';
import { CONTENT_PATH, type ContentType } from '../site';
import { ToolError, defined, savedSummary, slugify, type ToolContext } from './define';

type State = Parameters<typeof savedSummary>[2];

/**
 * Create a content item from one language's fields plus the language-independent fields.
 * A missing slug is derived from the name/title (ASCII only).
 */
export async function createContent(
  ctx: ToolContext,
  type: ContentType,
  input: { locale?: string; publish?: boolean; shared: Record<string, unknown>; tr: Record<string, unknown>; nameField: 'name' | 'title' },
) {
  const locale = ctx.locale(input.locale);
  const tr = defined(input.tr);
  if (!tr.slug) tr.slug = slugify(String(tr[input.nameField] ?? ''));
  const state = await ctx.client.post<State>(CONTENT_PATH[type], {
    doc: { ...defined(input.shared), translations: { [locale]: tr } },
    publish: input.publish,
  });
  return savedSummary(ctx, type, state, locale);
}

/**
 * Change an item: language-independent fields merge at the top level, `tr` merges into one
 * language (fields you leave out keep their value). Saved as a draft unless `publish`.
 */
export async function updateContent(
  ctx: ToolContext,
  type: ContentType,
  id: string,
  input: { locale?: string; version?: number; publish?: boolean; shared: Record<string, unknown>; tr: Record<string, unknown> },
) {
  const locale = ctx.locale(input.locale);
  const shared = defined(input.shared);
  const tr = defined(input.tr);
  const doc = { ...shared, ...(Object.keys(tr).length ? { translations: { [locale]: tr } } : {}) };
  if (Object.keys(doc).length === 0) throw new ToolError('Nothing to change: pass at least one field to update.');
  const state = await ctx.client.patch<State>(`${CONTENT_PATH[type]}/${seg(id)}`, { doc, version: input.version, publish: input.publish });
  return savedSummary(ctx, type, state, locale);
}

export async function deleteContent(ctx: ToolContext, type: ContentType, id: string) {
  await ctx.client.delete(`${CONTENT_PATH[type]}/${seg(id)}`);
  return { deleted: id, type, note: 'Moved to the trash: it is off the website and its URL can be reused. The site owner can restore it in the dashboard under System → Trash; tell the user what you deleted.' };
}
