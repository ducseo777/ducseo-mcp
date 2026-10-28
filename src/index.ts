import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ApiError, DucseoClient } from './client';
import { ConfigError, keyPrefix, loadConfig, type Config } from './config';
import { createProblemServer, createServer } from './server';
import { API_MAJOR, apiMajor, type Whoami } from './site';

// stdout carries the MCP protocol only; everything for humans goes to stderr (CLAUDE.md §7).
const log = (msg: string) => console.error(`[ducseo-mcp] ${msg}`);

type Connection = { problem: string } | { config: Config; client: DucseoClient; site: Whoami };

async function connect(): Promise<Connection> {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) return { problem: err.message };
    throw err;
  }

  const client = new DucseoClient(config);
  let site: Whoami;
  try {
    site = await client.get<Whoami>('/whoami');
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    if (err.code === 'unauthorized') {
      return {
        problem:
          `The API key ${keyPrefix(config.apiKey)} was rejected by ${config.siteUrl}: it is wrong, expired or revoked. Create a new key in the dashboard under "AI Agent" and update DUCSEO_API_KEY.\n` +
          `网站拒绝了 API Key ${keyPrefix(config.apiKey)}（错误、已过期或已吊销）。请在后台“AI Agent”菜单重新创建 Key，并更新 DUCSEO_API_KEY。`,
      };
    }
    return { problem: `${err.message}\n无法连接网站 ${config.siteUrl}，请检查网址和网络。` };
  }

  if (apiMajor(site.api.version) !== API_MAJOR) {
    return {
      problem:
        `${site.site.name} runs Agent API ${site.api.version}, but this Ducseo MCP speaks version ${API_MAJOR}.x. Update the MCP (restart the AI tool; npx fetches the latest) or ask the site developer.\n` +
        `网站的 Agent API 版本是 ${site.api.version}，当前 MCP 支持 ${API_MAJOR}.x。请重启 AI 工具以更新 MCP，或联系网站开发者。`,
    };
  }
  return { config, client, site };
}

async function main() {
  const c = await connect();
  const transport = new StdioServerTransport();
  if ('problem' in c) {
    log(c.problem);
    await createProblemServer(c.problem).connect(transport);
    return;
  }
  const { server, tools } = createServer(c.client, c.config, c.site);
  await server.connect(transport);
  log(`connected to ${c.site.site.name} (${c.config.siteUrl}), Agent API ${c.site.api.version}, key ${keyPrefix(c.config.apiKey)}, ${tools.length} tools`);
}

main().catch((err) => {
  log(`fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  process.exit(1);
});
