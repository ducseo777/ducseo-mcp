import { z, type ZodRawShape } from 'zod';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import type { DucseoClient } from '../client';
import type { Config } from '../config';
import { publicUrl, type ContentType, type Permission, type Whoami } from '../site';

export type ToolContext = {
  client: DucseoClient;
  config: Config;
  site: Whoami;
  /** The language to work in: the argument, else DUCSEO_LOCALE, else the site default. */
  locale: (requested?: string) => string;
};

export type ToolDef = {
  name: string;
  title: string;
  description: string;
  /** All of these must be granted by the key's scopes for the tool to be registered. */
  requires?: Permission[];
  /** whoami capability flag the site must report (older sites lack newer endpoints). */
  capability?: string;
  input: ZodRawShape;
  annotations?: ToolAnnotations;
  run: (args: any, ctx: ToolContext) => Promise<unknown>;
};

export function defineTool<S extends ZodRawShape>(
  def: Omit<ToolDef, 'input' | 'run'> & { input: S; run: (args: z.infer<z.ZodObject<S>>, ctx: ToolContext) => Promise<unknown> },
): ToolDef {
  return def as ToolDef;
}

/** A mistake the agent can fix by changing its arguments. */
export class ToolError extends Error {}

export const READ: ToolAnnotations = { readOnlyHint: true, openWorldHint: false };
export const WRITE: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
export const DESTRUCTIVE: ToolAnnotations = { readOnlyHint: false, destructiveHint: true, openWorldHint: false };

// --- Shared argument shapes ------------------------------------------------------

export const localeArg = z
  .string()
  .optional()
  .describe('Language code of the translation to read or write, e.g. "en", "es", "zh-CN". Defaults to the configured working language (see whoami).');

export const idArg = (what: string) => z.string().describe(`The ${what} id (26-character ULID from a list_* or get_* call).`);

export const versionArg = z
  .number()
  .int()
  .optional()
  .describe('Optional optimistic lock: the `version` from your last get_* call. If someone changed the item since, the site refuses with version_conflict instead of overwriting their work.');

export const publishArg = z
  .boolean()
  .optional()
  .describe('Publish immediately. Only set true when the user explicitly asked to publish and the key has content:publish; otherwise the change is saved as a draft for review.');

export const pageArgs = {
  page: z.number().int().min(1).optional().describe('Page number, from 1.'),
  pageSize: z.number().int().min(1).max(100).optional().describe('Items per page (max 100).'),
};

export const faqArg = z
  .array(z.object({ q: z.string().describe('Question as a buyer would ask it.'), a: z.string().describe('Answer, plain text or short Markdown.') }))
  .describe('FAQ items, output as FAQPage structured data. Use real buyer questions; 3–8 is typical.');

export const seoArgs = {
  metaTitle: z.string().nullable().optional().describe('SEO title, 30–60 characters (a Chinese, Japanese or Korean character counts as 2, so about 15–30 Chinese characters), main keyword first. The site appends the site name when it fits. null = generate from the name.'),
  metaDescription: z.string().nullable().optional().describe('Meta description, 120–160 characters (CJK characters count as 2, so about 60–80 Chinese characters): what it is, key specs or benefit, and a reason to inquire. null = generate from the summary.'),
  noindex: z.boolean().optional().describe('true keeps this language version out of search results and sitemaps (e.g. an unchecked machine translation). Default false.'),
};

export const markdownNote = 'Markdown (## to #### headings, lists, tables, links, **bold**). No raw HTML; it is stripped. Do not repeat the title as a heading.';

// --- Helpers ---------------------------------------------------------------------

/** Drops undefined values so PATCH bodies only carry what the agent actually set. */
export function defined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** ASCII slug from a name; fails for scripts it cannot transliterate (the agent must then pass one). */
export function slugify(text: string): string {
  const s = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '');
  if (!s) {
    throw new ToolError(`Could not make a URL slug from "${text}". Pass \`slug\` yourself: lowercase letters, digits and hyphens in the page's language, e.g. "stainless-steel-ball-valve".`);
  }
  return s;
}

/** Paging hint so the agent knows whether to ask for more. */
export function paging(total: number, page: number, pageSize: number) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return { total, page, pageSize, pages, next: page < pages ? `More results: call again with page=${page + 1}.` : undefined };
}

type ContentState = {
  id: string;
  status: 'draft' | 'published' | 'archived';
  version: number;
  hasDraft: boolean;
  sample?: boolean;
  doc: { kind?: string; translations: Record<string, { slug?: string; name?: string; title?: string }> };
  /** Signed draft preview links per locale (Agent API 1.3+). */
  preview?: { urls: Record<string, string>; expiresAt: number };
};

const ADMIN_PATH: Record<ContentType, string> = { product: 'products', category: 'categories', page: 'pages', post: 'blog' };

/** What a write returns to the agent: where things stand and what the user should do next. */
export function savedSummary(ctx: ToolContext, type: ContentType, state: ContentState, locale: string) {
  const translations = state.doc.translations ?? {};
  const tr = translations[locale] ?? Object.values(translations)[0];
  const trLocale = translations[locale] ? locale : Object.keys(translations)[0];
  const live = state.status === 'published';
  const note = !live
    ? 'Saved as a draft. It is not on the website until it is published; previewUrl shows how it will look (valid 7 days).'
    : state.hasDraft
      ? 'Saved as a draft on top of the live version. Visitors still see the previous version until it is published; previewUrl shows the new version.'
      : 'Live on the website.';
  return {
    id: state.id,
    type,
    title: tr?.name ?? tr?.title,
    status: state.status,
    hasUnpublishedChanges: state.hasDraft,
    version: state.version,
    locales: Object.keys(translations),
    liveUrl: live && tr?.slug && trLocale ? publicUrl(ctx.site, type, trLocale, tr.slug, state.doc.kind) : null,
    // Shows unpublished changes as they will look on the site; give it to the user for review.
    previewUrl: (!live || state.hasDraft) && trLocale ? (state.preview?.urls[trLocale] ?? null) : null,
    reviewInDashboard: `${ctx.config.siteUrl}/admin/${ADMIN_PATH[type]}/${state.id}`,
    note,
  };
}
