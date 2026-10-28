import { defineConfig } from 'tsup';

// One self-contained file: the MCP SDK and zod are bundled, so `npx github:ducseo777/ducseo-mcp`
// installs nothing from npm and starts fast. dist/ is committed (CLAUDE.md §2).
export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  outDir: 'dist',
  clean: true,
  bundle: true,
  noExternal: [/.*/],
  minify: false,
  sourcemap: false,
  splitting: false,
  banner: {
    // Bundled CommonJS dependencies may call require(); give them one.
    js: "#!/usr/bin/env node\nimport { createRequire as __createRequire } from 'node:module';\nconst require = __createRequire(import.meta.url);",
  },
});
