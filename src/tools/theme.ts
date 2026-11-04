import { z } from 'zod';
import { READ, WRITE, defineTool, versionArg } from './define';

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a 6-digit hex color such as "#1d4ed8".');

export const getTheme = defineTool({
  name: 'get_theme',
  title: 'Current theme',
  description:
    'The site theme: design (industrial, engineering, living or oem), brand colors (primary, accent, surfaceDark), heading and body fonts, product image ratio, plus notes from the contrast check. Returns { theme, notes, version }.',
  requires: ['settings.read'],
  input: {},
  annotations: READ,
  run: (_args, ctx) => ctx.client.get('/theme'),
});

export const listThemePresets = defineTool({
  name: 'list_theme_presets',
  title: 'Designs and fonts',
  description:
    'The four designs with the industries each fits, their default colors and the fonts each design allows. Use it to recommend a design for the client\'s industry before apply_theme_preset or update_theme.',
  requires: ['settings.read'],
  input: {},
  annotations: READ,
  run: (_args, ctx) => ctx.client.get('/theme/presets'),
});

export const updateTheme = defineTool({
  name: 'update_theme',
  title: 'Change brand colors, fonts or card layout',
  description:
    'Change parts of the theme; nested colors and fonts merge with the current values. Fonts must be from the current design\'s list (list_theme_presets). Low-contrast colors are corrected automatically and explained in `notes`; report those notes to the user. Custom CSS is not possible. To switch the design itself, use apply_theme_preset.',
  requires: ['settings.write'],
  input: {
    colors: z
      .object({ primary: hex.optional(), accent: hex.optional(), surfaceDark: hex.optional() })
      .optional()
      .describe('primary: buttons, links, highlights (usually the logo color). accent: small highlights such as figures. surfaceDark: dark sections and footer.'),
    fonts: z.object({ heading: z.string().optional(), body: z.string().optional() }).optional().describe('Font ids from list_theme_presets.'),
    productImageRatio: z.enum(['1:1', '4:3']).optional().describe('Shape of product images in cards and on product pages.'),
    mobileProductColumns: z
      .union([z.literal(1), z.literal(2)])
      .optional()
      .describe(
        'Product and category cards per row on phones. 2 suits large catalogs (compact cards: image and name only); 1 shows key specs on every card. Needs the "mobile-columns" capability (see whoami); older sites ignore it.',
      ),
    version: versionArg,
  },
  annotations: WRITE,
  run: ({ version, ...theme }, ctx) => ctx.client.patch('/theme', { theme, version }),
});

export const applyThemePreset = defineTool({
  name: 'apply_theme_preset',
  title: 'Switch design',
  description:
    'Switch the site to another design (layout, styling and its fonts). Brand colors and the image ratio are kept unless useDesignDefaults. Content is never changed. Confirm with the user before switching a live site.',
  requires: ['settings.write'],
  input: {
    preset: z.enum(['industrial', 'engineering', 'living', 'oem']).describe('industrial: machinery and electrical; engineering: building materials and energy; living: home and lifestyle; oem: light-industry OEM.'),
    useDesignDefaults: z.boolean().optional().describe('Also take the design\'s default colors and image ratio.'),
    applyLayouts: z.boolean().optional().describe("Also restyle every page's blocks with the design's recommended layouts (needs content:publish)."),
    version: versionArg,
  },
  annotations: WRITE,
  run: (args, ctx) => ctx.client.post('/theme/preset', args),
});

export const themeTools = [getTheme, listThemePresets, updateTheme, applyThemePreset];
