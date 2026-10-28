import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, extname, resolve } from 'node:path';
import { z } from 'zod';
import { READ, ToolError, defineTool } from './define';

export const getContentGuidelines = defineTool({
  name: 'get_content_guidelines',
  title: 'Writing guidelines and company facts',
  description:
    'Read before writing any copy: the company fact sheet (the only facts you may state), which facts are missing, brand tone, main keywords, words to avoid, writing rules and SEO length rules. If facts you need are missing, ask the user instead of guessing.',
  requires: ['content.read'],
  capability: 'guidelines',
  input: {},
  annotations: READ,
  run: (_args, ctx) => ctx.client.get('/guidelines'),
});

export const runSeoCheck = defineTool({
  name: 'run_seo_check',
  title: 'SEO check',
  description:
    'Check the published content for SEO problems: missing domain or home page, blocked AI crawlers, SEO titles and descriptions (missing, length, duplicates), thin pages, product images and alt text, products without category, empty categories, broken internal links and untranslated content. Errors first; each issue says what to do and which item it concerns. Fix content issues with the update tools, then run it again.',
  requires: ['content.read'],
  capability: 'seo-check',
  input: {},
  annotations: READ,
  run: (_args, ctx) => ctx.client.get('/seo/check'),
});

// DESIGN.md §11 of the Ducseo project: what a third-party design file may change on the site.
const IMPORT_RULES = [
  'Pick the closest of the site designs (industrial, engineering, living, oem) from the overall character: industry, density, corner radius, serif or sans-serif.',
  "colors.primary = the brand's primary or main call-to-action color.",
  'colors.accent = the secondary highlight color.',
  'colors.surfaceDark = the background of dark sections.',
  "Fonts: the closest heading and body fonts from the chosen design's font list. Commercial fonts are never used; pick the nearest free one from the list.",
  'Ignore neutrals, radii, shadows, component details, gradients and decorations: the design decides those.',
  "Import values only: never copy the other brand's name, logo, illustrations or images.",
  'Low-contrast colors are corrected automatically when saved; tell the user what was changed (the `notes` in the result).',
];

const MAX_BYTES = 256 * 1024;

export const importDesignMd = defineTool({
  name: 'import_design_md',
  title: 'Import a DESIGN.md',
  description:
    'Read a third-party DESIGN.md file on this computer (e.g. from the awesome-design-md collection) and get the rules for turning it into this site\'s theme, the available designs and fonts, and the current theme. Then decide the mapping yourself, show the user your choice (design, three colors, two fonts) and, once they agree, apply it with apply_theme_preset and update_theme.',
  requires: ['settings.read', 'settings.write'],
  capability: 'theme',
  input: { path: z.string().describe('Absolute path of the .md file on this computer.') },
  annotations: READ,
  run: async ({ path }, ctx) => {
    const full = resolve(path.startsWith('~') ? homedir() + path.slice(1) : path);
    if (!['.md', '.markdown', '.txt'].includes(extname(full).toLowerCase())) {
      throw new ToolError(`"${basename(full)}" is not a Markdown file. Pass the path of a DESIGN.md (.md) file.`);
    }
    let size: number;
    try {
      const info = await stat(full);
      if (!info.isFile()) throw new Error('not a file');
      size = info.size;
    } catch {
      throw new ToolError(`File not found: ${full}. Use an absolute path to a file on this computer.`);
    }
    if (size > MAX_BYTES) throw new ToolError(`${basename(full)} is ${Math.round(size / 1024)} KB; a design file should be well under ${MAX_BYTES / 1024} KB.`);
    const [designMd, options, current] = await Promise.all([readFile(full, 'utf8'), ctx.client.get('/theme/presets'), ctx.client.get('/theme')]);
    return {
      file: basename(full),
      rules: IMPORT_RULES,
      designsAndFonts: options,
      currentTheme: current,
      designMd,
      nextSteps: 'Propose: design id, primary/accent/surfaceDark hex colors, heading and body font ids (from that design). After the user agrees: apply_theme_preset (if the design changes), then update_theme with colors and fonts.',
    };
  },
});

export const guidanceTools = [getContentGuidelines, runSeoCheck, importDesignMd];
