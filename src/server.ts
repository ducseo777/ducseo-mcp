import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { version } from '../package.json';
import { ApiError, type DucseoClient } from './client';
import type { Config } from './config';
import { permissionsOf, type Whoami } from './site';
import { ToolError, type ToolContext, type ToolDef } from './tools/define';
import { categoryTools } from './tools/categories';
import { guidanceTools } from './tools/guidance';
import { inquiryTools } from './tools/inquiries';
import { mediaTools } from './tools/media';
import { pageTools } from './tools/pages';
import { postTools } from './tools/posts';
import { productTools } from './tools/products';
import { publishTools } from './tools/publish';
import { seoTools } from './tools/seo';
import { siteTools } from './tools/site';
import { themeTools } from './tools/theme';
import { translationTools } from './tools/translations';

export const VERSION = version;

export const ALL_TOOLS: ToolDef[] = [
  ...siteTools,
  ...guidanceTools,
  ...themeTools,
  ...categoryTools,
  ...productTools,
  ...pageTools,
  ...postTools,
  ...translationTools,
  ...mediaTools,
  ...seoTools,
  ...publishTools,
  ...inquiryTools,
];

/** Tools this key may use on this site version (CLAUDE.md §4): unusable tools are not offered at all. */
export function selectTools(site: Whoami): ToolDef[] {
  const perms = permissionsOf(site.key.scopes);
  return ALL_TOOLS.filter((t) => (t.requires ?? []).every((p) => perms.has(p)) && (!t.capability || site.api.capabilities.includes(t.capability)));
}

export function instructions(site: Whoami, workingLocale: string): string {
  const scopes = site.key.scopes;
  const canPublish = scopes.includes('content:publish');
  return [
    `You manage the B2B export website "${site.site.name}" (${site.site.url}) through its Agent API.`,
    `Site languages: ${site.locales.enabled.join(', ')} (default ${site.locales.default}). Work in "${workingLocale}" unless the user says otherwise.`,
    '',
    'How to work:',
    '- Start with whoami to confirm the site and permissions, then get_site_overview to see what exists and what is missing.',
    '- Before writing copy, read get_content_guidelines: the company fact sheet, brand voice, keywords and writing rules for this site.',
    '- Read before you write: get_* the item first, change only what the user asked, and keep existing content.',
    "- Never invent company facts: founding year, factory size, staff, capacity, certifications, customers, export countries, prices or specs come only from the user's material. If something is missing, ask; do not guess.",
    '- Write for overseas B2B buyers (importers, distributors, engineers) in natural target-language wording, not a literal translation from Chinese. Keep numbers, units, model numbers and standards exact.',
    '- SEO: one main keyword per page, used naturally; meta titles 30–60 characters, meta descriptions 120–160. Do not stuff keywords.',
    '- Pages are built from blocks: call list_block_types before creating or editing blocks.',
    '- Upload images with upload_media (local files) and always give alt text; then use the returned media id.',
    canPublish
      ? '- Changes are saved as drafts. Publish only when the user explicitly asks; otherwise tell them the change is waiting for review.'
      : '- This key cannot publish: everything you save is a draft for the site owner to review and publish in the dashboard.',
    '- After writing, give the user the reviewInDashboard link (and liveUrl when live) from the tool result.',
    '- If the site answers version_conflict, someone else edited the item: read it again, re-apply your change, then save.',
  ].join('\n');
}

function errorResult(text: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text }] };
}

const HINTS: Record<string, string> = {
  version_conflict: 'Someone changed this since you read it. Call the matching get_* tool again, re-apply your change to the current version and retry.',
  forbidden: 'This API key is not allowed to do that. The site owner can create a key with the needed permission in the dashboard under "AI Agent".',
  unauthorized: 'The API key is invalid, expired or revoked. Ask the user for a new key (dashboard → AI Agent) and to update the MCP configuration.',
  not_found: 'Check the id with the matching list_* tool.',
};

/** Runs a tool and turns every failure into a message the agent can act on (CLAUDE.md §5). */
export async function runTool(tool: ToolDef, args: unknown, ctx: ToolContext): Promise<CallToolResult> {
  try {
    const result = await tool.run(args ?? {}, ctx);
    const text = result === null || result === undefined ? 'Done.' : typeof result === 'string' ? result : JSON.stringify(result);
    return { content: [{ type: 'text', text }] };
  } catch (err) {
    if (err instanceof ApiError) {
      const parts = [`The site refused: ${err.code}${err.status ? ` (HTTP ${err.status})` : ''}: ${err.message}`];
      if (err.details !== undefined) parts.push(`Details: ${JSON.stringify(err.details).slice(0, 4000)}`);
      if (err.code === 'rate_limited') {
        const after = (err.details as { retryAfter?: number } | undefined)?.retryAfter;
        parts.push(`Wait ${after ?? 60} seconds before retrying.`);
      } else if (HINTS[err.code]) parts.push(HINTS[err.code]!);
      return errorResult(parts.join('\n'));
    }
    if (err instanceof ToolError) return errorResult(err.message);
    console.error(`[ducseo-mcp] ${tool.name} failed:`, err);
    return errorResult(`Unexpected error in ${tool.name}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function createServer(client: DucseoClient, config: Config, site: Whoami): { server: McpServer; tools: ToolDef[] } {
  const workingLocale = config.locale ?? site.locales.default;
  const ctx: ToolContext = {
    client,
    config,
    site,
    locale: (requested) => {
      const l = requested ?? workingLocale;
      if (!site.locales.enabled.includes(l)) {
        throw new ToolError(`Language "${l}" is not enabled on this site. Enabled: ${site.locales.enabled.join(', ')}.`);
      }
      return l;
    },
  };
  const server = new McpServer({ name: 'ducseo', version: VERSION }, { instructions: instructions(site, workingLocale) });
  const tools = selectTools(site);
  for (const tool of tools) {
    server.registerTool(tool.name, { title: tool.title, description: tool.description, inputSchema: tool.input, annotations: tool.annotations }, (args: unknown) =>
      runTool(tool, args, ctx),
    );
  }
  return { server, tools };
}

/**
 * When the site cannot be used (bad configuration, wrong key, site offline, incompatible version)
 * the server still starts with a single `whoami` tool that explains the problem, so the person
 * sees it in the chat instead of in a log file.
 */
export function createProblemServer(problem: string): McpServer {
  const server = new McpServer(
    { name: 'ducseo', version: VERSION },
    { instructions: `The Ducseo website connection is not working. Call whoami and tell the user exactly what it says, in their language.` },
  );
  server.registerTool(
    'whoami',
    { title: 'Connection status', description: 'Explains why the Ducseo website connection is not working and how to fix it.', annotations: { readOnlyHint: true } },
    () => errorResult(`Ducseo MCP is not connected.\n${problem}`),
  );
  return server;
}
