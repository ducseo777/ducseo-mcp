// What `GET /whoami` tells us, and what tools derive from it.

export type Whoami = {
  site: { name: string; url: string; version: string };
  api: { version: string; capabilities: string[] };
  locales: { default: string; enabled: string[] };
  key: { id?: string; name: string; prefix: string; scopes: string[]; expiresAt: number | null };
};

/** Agent API major version this MCP speaks (CLAUDE.md §8). */
export const API_MAJOR = 1;

export type Permission =
  | 'content.read'
  | 'content.write'
  | 'content.publish'
  | 'media.write'
  | 'settings.read'
  | 'settings.write'
  | 'inquiries.read';

// Mirror of the site's scope → permission table (Ducseo src/server/auth/actor.ts). The site still
// checks every call; this only decides which tools are worth showing to the AI.
const SCOPE_PERMISSIONS: Record<string, Permission[]> = {
  read: ['content.read', 'settings.read'],
  'content:draft': ['content.write'],
  'content:publish': ['content.write', 'content.publish'],
  'media:write': ['media.write'],
  'settings:write': ['settings.read', 'settings.write'],
  'inquiries:read': ['inquiries.read'],
};

export function permissionsOf(scopes: string[]): Set<Permission> {
  return new Set(scopes.flatMap((s) => SCOPE_PERMISSIONS[s] ?? []));
}

export function apiMajor(version: string): number {
  return Number.parseInt(version.split('.')[0] ?? '', 10);
}

export type ContentType = 'product' | 'category' | 'page' | 'post';

export const CONTENT_PATH: Record<ContentType, string> = {
  product: '/products',
  category: '/categories',
  page: '/pages',
  post: '/posts',
};

/** Public URL of a piece of content, matching the site's URL scheme (Ducseo src/lib/urls.ts). */
export function publicUrl(site: Whoami, type: ContentType, locale: string, slug: string, kind?: string): string {
  const prefix = locale === site.locales.default ? '' : `/${locale.toLowerCase()}`;
  const path =
    type === 'product'
      ? `/product/${slug}/`
      : type === 'category'
        ? `/products/${slug}/`
        : type === 'post'
          ? `/blog/${slug}/`
          : kind === 'home'
            ? '/'
            : `/${slug}/`;
  return `${site.site.url.replace(/\/+$/, '')}${prefix}${path}`;
}
