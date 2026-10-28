import { z } from 'zod';
import { seg } from '../client';
import { CONTENT_PATH } from '../site';
import { READ, ToolError, WRITE, defineTool, publishArg, savedSummary, slugify, versionArg } from './define';

const contentType = z.enum(['product', 'category', 'page', 'post']).describe('Kind of content.');

export const listMissingTranslations = defineTool({
  name: 'list_missing_translations',
  title: 'Find untranslated content',
  description:
    'Products, categories, pages and posts that have no translation yet in one or all enabled site languages, with their title and the languages present. Use it to plan translation work, then call upsert_translation for each item.',
  requires: ['content.read'],
  capability: 'missing-translations',
  input: {
    locale: z.string().optional().describe('Only this language; omit for all enabled languages.'),
    type: contentType.optional(),
  },
  annotations: READ,
  run: (args, ctx) => ctx.client.get('/translations/missing', args),
});

export const upsertTranslation = defineTool({
  name: 'upsert_translation',
  title: 'Add or update a translation',
  description:
    'Write one language version of a product, category, page or post. Fields you pass are set; fields you leave out keep their value. A new language needs at least the name (product, category) or title (page, post); the slug is derived when it can be. ' +
    'Fields per type: product: name, slug, summary, body, specs, trade, faq, metaTitle, metaDescription, noindex. category: name, slug, intro, body, faq, facts, metaTitle, metaDescription, noindex. ' +
    'page: title, slug, blocks, metaTitle, metaDescription, noindex. post: title, slug, excerpt, body, metaTitle, metaDescription, noindex. ' +
    'Translate for native B2B buyers, not word for word; keep numbers, units, model numbers and standards exactly. For pages, keep block ids, types and media ids and translate only the text in `data`. Slugs should be in the target language (ASCII). Saved as a draft unless publish=true.',
  requires: ['content.write'],
  input: {
    type: contentType,
    id: z.string().describe('Id of the item.'),
    locale: z.string().describe('Target language code, e.g. "es". Must be enabled on the site (whoami).'),
    fields: z.record(z.string(), z.unknown()).describe('Translated fields, e.g. {"name": "Válvula de bola", "summary": "..."}.'),
    version: versionArg,
    publish: publishArg,
  },
  annotations: WRITE,
  run: async ({ type, id, locale, fields, version, publish }, ctx) => {
    if (!ctx.site.locales.enabled.includes(locale)) {
      throw new ToolError(`Language "${locale}" is not enabled on this site. Enabled: ${ctx.site.locales.enabled.join(', ')}. The site owner can enable more under Settings → Languages.`);
    }
    const path = `${CONTENT_PATH[type]}/${seg(id)}`;
    const tr = { ...fields };
    const name = (tr.name ?? tr.title) as string | undefined;
    if (!tr.slug && name) {
      // Only a brand-new language needs a slug; existing ones keep theirs.
      const cur = await ctx.client.get<{ doc: { translations: Record<string, unknown> } }>(path);
      if (!cur.doc.translations[locale]) tr.slug = slugify(name);
    }
    const state = await ctx.client.patch<Parameters<typeof savedSummary>[2]>(path, { doc: { translations: { [locale]: tr } }, version, publish });
    return savedSummary(ctx, type, state, locale);
  },
});

export const translationTools = [listMissingTranslations, upsertTranslation];
