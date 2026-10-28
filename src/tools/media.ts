import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, extname, resolve } from 'node:path';
import { z } from 'zod';
import { seg } from '../client';
import { READ, ToolError, WRITE, defineTool, pageArgs, paging } from './define';

const MB = 1024 * 1024;
// Same types and limits as the site (Ducseo src/server/services/media.ts); checked here so a wrong
// file fails before it is uploaded. SVG is refused on purpose: it can carry scripts.
const TYPES: Record<string, { mime: string; max: number }> = {
  '.jpg': { mime: 'image/jpeg', max: 10 * MB },
  '.jpeg': { mime: 'image/jpeg', max: 10 * MB },
  '.png': { mime: 'image/png', max: 10 * MB },
  '.webp': { mime: 'image/webp', max: 10 * MB },
  '.gif': { mime: 'image/gif', max: 5 * MB },
  '.avif': { mime: 'image/avif', max: 10 * MB },
  '.pdf': { mime: 'application/pdf', max: 25 * MB },
};

type MediaItem = { url?: string };

/** The site returns /media/… paths when it has no media domain; give the agent full URLs it can show. */
function absolute<T extends MediaItem>(item: T, siteUrl: string): T {
  return item.url?.startsWith('/') ? { ...item, url: `${siteUrl}${item.url}` } : item;
}

const altArg = z
  .record(z.string(), z.string())
  .optional()
  .describe('Alt text per language, e.g. {"en": "316 stainless steel flanged ball valve, DN50"}. Describe what is in the picture with the product name; no "image of".');

/** Reads exactly one user-named file (CLAUDE.md §7): no directories, no globbing. */
export async function readUploadFile(path: string) {
  const full = resolve(path.startsWith('~') ? homedir() + path.slice(1) : path);
  const type = TYPES[extname(full).toLowerCase()];
  if (!type) throw new ToolError(`"${basename(full)}" is not an accepted file type. Upload JPEG, PNG, WebP, GIF, AVIF or PDF (SVG is not accepted).`);
  let info;
  try {
    info = await stat(full);
  } catch {
    throw new ToolError(`File not found: ${full}. Use an absolute path to a file on this computer.`);
  }
  if (!info.isFile()) throw new ToolError(`${full} is not a file. Upload files one at a time.`);
  if (info.size > type.max) {
    throw new ToolError(`${basename(full)} is ${(info.size / MB).toFixed(1)} MB; the limit for this type is ${type.max / MB} MB. Compress or resize it first.`);
  }
  return { name: basename(full), mime: type.mime, bytes: await readFile(full) };
}

export const uploadMedia = defineTool({
  name: 'upload_media',
  title: 'Upload a local file',
  description:
    "Upload one image or PDF from this computer (product photos, certificates, datasheets) to the site's media library and get its media id for products, pages and settings. Images up to 10 MB (GIF 5 MB), PDF up to 25 MB. Always give alt text for images.",
  requires: ['media.write'],
  capability: 'media',
  input: { path: z.string().describe('Absolute path of the file, e.g. "C:\\\\Users\\\\me\\\\Pictures\\\\valve.jpg" or "/Users/me/valve.jpg".'), alt: altArg },
  annotations: WRITE,
  run: async ({ path, alt }, ctx) => {
    const file = await readUploadFile(path);
    const form = new FormData();
    form.set('file', new Blob([new Uint8Array(file.bytes)], { type: file.mime }), file.name);
    if (alt) form.set('alt', JSON.stringify(alt));
    return absolute(await ctx.client.upload<MediaItem>('/media', form), ctx.config.siteUrl);
  },
});

export const uploadMediaFromUrl = defineTool({
  name: 'upload_media_from_url',
  title: 'Import a file from a URL',
  description: 'Have the site download an image or PDF from a public URL (e.g. the client\'s old website) into the media library. Only use files the client owns or may use.',
  requires: ['media.write'],
  capability: 'media',
  input: {
    url: z.string().describe('http(s) URL of the file.'),
    alt: altArg,
    filename: z.string().optional().describe('File name to store, e.g. "ball-valve-dn50.jpg".'),
  },
  annotations: WRITE,
  run: async ({ url, alt, filename }, ctx) => absolute(await ctx.client.post<MediaItem>('/media/import', { url, alt: alt ?? {}, filename }), ctx.config.siteUrl),
});

export const listMedia = defineTool({
  name: 'list_media',
  title: 'List media',
  description: 'Files in the media library with id, URL, file name, size and alt text per language. Filter by text, type or missing alt text. Paginated.',
  requires: ['content.read'],
  capability: 'media',
  input: {
    q: z.string().optional().describe('Search file name or alt text.'),
    type: z.enum(['image', 'pdf']).optional(),
    missingAlt: z.boolean().optional().describe('Only images that lack alt text in at least one enabled language.'),
    ...pageArgs,
  },
  annotations: READ,
  run: async ({ missingAlt, ...args }, ctx) => {
    if (missingAlt && !ctx.site.api.capabilities.includes('media-missing-alt')) {
      throw new ToolError('This site version cannot filter by missing alt text. List all images and check the `alt` field of each instead.');
    }
    const res = await ctx.client.get<{ items: MediaItem[]; total: number; page: number; pageSize: number }>('/media', { ...args, missingAlt: missingAlt ? '1' : undefined });
    return { items: res.items.map((m) => absolute(m, ctx.config.siteUrl)), ...paging(res.total, res.page, res.pageSize) };
  },
});

export const updateMediaAlt = defineTool({
  name: 'update_media_alt',
  title: 'Set alt text',
  description: 'Set alt text for an image in one or more languages. Languages you leave out keep their text; an empty string removes it.',
  requires: ['media.write'],
  capability: 'media',
  input: { id: z.string().describe('Media id.'), alt: z.record(z.string(), z.string()).describe('Alt text per language, e.g. {"en": "...", "es": "..."}.') },
  annotations: WRITE,
  run: async ({ id, alt }, ctx) => absolute(await ctx.client.patch<MediaItem>(`/media/${seg(id)}`, { alt }), ctx.config.siteUrl),
});

export const mediaTools = [uploadMedia, uploadMediaFromUrl, listMedia, updateMediaAlt];
