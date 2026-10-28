import { z } from 'zod';
import type { Whoami } from '../site';
import { READ, WRITE, defineTool, versionArg } from './define';

const SCOPE_TEXT: Record<string, string> = {
  read: 'read all content and settings',
  'content:draft': 'create and edit content as drafts',
  'content:publish': 'publish, unpublish and roll back content',
  'media:write': 'upload media and edit alt text',
  'settings:write': 'change site settings, navigation and theme',
  'inquiries:read': "read inquiries (buyers' personal data)",
};

export const whoami = defineTool({
  name: 'whoami',
  title: 'Who am I connected to',
  description:
    'Which Ducseo website this connection manages, the Agent API version, the enabled site languages and what this API key may do. Call it first in a session, and whenever the user asks which site you are connected to.',
  input: {},
  annotations: READ,
  run: async (_args, ctx) => {
    const me = await ctx.client.get<Whoami>('/whoami');
    return {
      site: me.site,
      api: me.api,
      languages: { default: me.locales.default, enabled: me.locales.enabled, workingLanguage: ctx.locale() },
      key: { name: me.key.name, prefix: me.key.prefix, expiresAt: me.key.expiresAt ? new Date(me.key.expiresAt).toISOString() : null },
      canDo: me.key.scopes.map((s) => SCOPE_TEXT[s] ?? s),
    };
  },
});

export const getSiteOverview = defineTool({
  name: 'get_site_overview',
  title: 'Site overview',
  description:
    'Content counts, sample content still left from setup, content gaps (missing translations, SEO descriptions, image alt text) and the go-live checklist. Call after whoami to plan work.',
  requires: ['content.read'],
  capability: 'overview',
  input: {},
  annotations: READ,
  run: (_args, ctx) => ctx.client.get('/overview'),
});

const SETTING_KEYS = ['site', 'contact', 'social', 'facts', 'voice', 'analytics', 'navigation', 'seo', 'inquiry', 'turnstile'] as const;

export const getSettings = defineTool({
  name: 'get_settings',
  title: 'Read site settings',
  description:
    'Read one settings group. site: name, tagline per language, production URL, logo/favicon media ids. contact: email, phone, WhatsApp, address/hours per language, map. social: profile URLs. facts: the company fact sheet. voice: brand tone, keywords, words to avoid. analytics: tracking IDs and cookie consent mode. navigation: header/footer menus. seo, inquiry, turnstile: read-only for AI. Returns { value, version }.',
  requires: ['settings.read'],
  input: { key: z.enum(SETTING_KEYS).describe('Settings group to read.') },
  annotations: READ,
  run: ({ key }, ctx) => ctx.client.get(`/settings/${key}`),
});

export const updateSiteSettings = defineTool({
  name: 'update_site_settings',
  title: 'Update site settings',
  description:
    'Change fields of the site, contact, social, facts, voice or analytics settings. Only the fields you pass change (shallow merge); per-language fields such as tagline, address and hours are objects keyed by language, e.g. {"tagline": {"en": "...", "es": "..."}}. ' +
    'facts (company fact sheet): foundedYear (number), employees, factoryArea, capacity, annualSales, exportCountries (text), markets and customers (lists of text), certifications [{name, detail}], other [{label, value}]; lists you pass replace the old list. voice: tone, keywords (list), avoid. ' +
    'analytics (sites with the "analytics" capability): ga4 ("G-..."), gtm ("GTM-..."), clarity, metaPixel, linkedin (partner id), cloudflare (Web Analytics token), consent ("banner" = cookie banner, tags wait for consent; "none"), privacyUrl ("/privacy-policy/"); empty string turns a tag off. Custom HTML code cannot be set by AI. ' +
    'Use only what the user tells you or gives you: never invent facts, phone numbers, addresses or emails. Media fields (logoMediaId, logoDarkMediaId, faviconMediaId) take ids from upload_media.',
  requires: ['settings.write'],
  input: {
    key: z.enum(['site', 'contact', 'social', 'facts', 'voice', 'analytics']).describe('Settings group (facts and voice need the "facts" capability, analytics the "analytics" capability).'),
    value: z.record(z.string(), z.unknown()).describe('Fields to change, e.g. {"email": "sales@example.com", "whatsapp": "+86 138 0000 0000"}.'),
    version: versionArg,
  },
  annotations: WRITE,
  run: ({ key, value, version }, ctx) => ctx.client.patch(`/settings/${key}`, { value, version }),
});

const navItem = z.object({
  kind: z.enum(['home', 'products', 'blog', 'contact', 'page', 'link']).describe('Built-in page, a custom page ("page" + pageId) or any URL ("link" + href).'),
  pageId: z.string().optional().describe('For kind "page": the page id from list_pages.'),
  href: z.string().optional().describe('For kind "link": a path starting with "/" or an https:// URL.'),
  label: z.record(z.string(), z.string()).optional().describe('Label per language, e.g. {"en": "Factory"}. Empty uses the page title or built-in name; required for "link".'),
});

export const updateNavigation = defineTool({
  name: 'update_navigation',
  title: 'Update menus',
  description:
    'Replace the header menu and/or the footer "Company" links. Pass the full list for each menu you change (order = display order). An empty header list restores the automatic menu (Home, Products, Blog once posts exist, Contact); an empty footer list mirrors the header. The Products item gets the category dropdown automatically. Read the current menus with get_settings key="navigation" first.',
  requires: ['settings.write'],
  input: {
    header: z.array(navItem).max(10).optional().describe('Header menu, at most 10 items.'),
    footer: z.array(navItem).max(12).optional().describe('Footer links, at most 12 items.'),
    version: versionArg,
  },
  annotations: WRITE,
  run: ({ header, footer, version }, ctx) => ctx.client.patch('/settings/navigation', { value: { ...(header && { header }), ...(footer && { footer }) }, version }),
});

export const siteTools = [whoami, getSiteOverview, getSettings, updateSiteSettings, updateNavigation];
