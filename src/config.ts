// Configuration from the AI tool's MCP settings (CLAUDE.md §3). Errors are bilingual because the
// person reading them is usually setting this up by hand.

import { proxyFor } from './proxy';

export type Config = {
  /** Site origin, e.g. https://www.example.com (no path, no trailing slash). */
  siteUrl: string;
  apiKey: string;
  /** Language the agent works in by default; undefined = the site's default language. */
  locale?: string;
  /** HTTP proxy for requests to the site (DUCSEO_PROXY, HTTPS_PROXY …); see proxy.ts. */
  proxy?: URL;
};

export class ConfigError extends Error {}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const rawUrl = env.DUCSEO_SITE_URL?.trim();
  const apiKey = env.DUCSEO_API_KEY?.trim();
  const locale = env.DUCSEO_LOCALE?.trim() || undefined;

  if (!rawUrl) {
    throw new ConfigError(
      'DUCSEO_SITE_URL is not set. Add it to this MCP server\'s "env", e.g. "https://www.example.com".\n' +
        '没有设置 DUCSEO_SITE_URL。请在 MCP 配置的 env 里填写网站地址，例如 "https://www.example.com"。',
    );
  }
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ConfigError(`DUCSEO_SITE_URL "${rawUrl}" is not a valid URL.\nDUCSEO_SITE_URL "${rawUrl}" 不是有效的网址。`);
  }
  // Plain http only for a site running on this computer (development).
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname))) {
    throw new ConfigError(
      `DUCSEO_SITE_URL must start with https:// (got "${rawUrl}").\nDUCSEO_SITE_URL 必须以 https:// 开头（当前是 "${rawUrl}"）。`,
    );
  }

  if (!apiKey) {
    throw new ConfigError(
      'DUCSEO_API_KEY is not set. Create a key in the site dashboard under "AI Agent" and add it to this MCP server\'s "env".\n' +
        '没有设置 DUCSEO_API_KEY。请在网站后台“AI Agent”菜单创建 API Key，并填到 MCP 配置的 env 里。',
    );
  }
  if (!/^dsk_[A-Za-z0-9_-]{8,}$/.test(apiKey)) {
    throw new ConfigError(
      `DUCSEO_API_KEY does not look like a Ducseo key (it should start with "dsk_"; got "${keyPrefix(apiKey)}").\n` +
        `DUCSEO_API_KEY 格式不对，应该以 "dsk_" 开头（当前是 "${keyPrefix(apiKey)}"）。`,
    );
  }

  if (locale && !/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(locale)) {
    throw new ConfigError(`DUCSEO_LOCALE "${locale}" is not a language code such as "en" or "zh-CN".\nDUCSEO_LOCALE "${locale}" 不是语言代码，例如 "en" 或 "zh-CN"。`);
  }

  const explicitProxy = env.DUCSEO_PROXY?.trim();
  if (explicitProxy) {
    let ok = false;
    try {
      ok = /^https?:$/.test(new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(explicitProxy) ? explicitProxy : `http://${explicitProxy}`).protocol);
    } catch {
      ok = false;
    }
    if (!ok) {
      throw new ConfigError(
        `DUCSEO_PROXY "${explicitProxy}" is not an HTTP proxy address such as "http://127.0.0.1:7890" (SOCKS is not supported; use your proxy app's HTTP port).
` +
          `DUCSEO_PROXY "${explicitProxy}" 不是 HTTP 代理地址，应类似 "http://127.0.0.1:7890"（不支持 SOCKS，请填代理软件的 HTTP 端口）。`,
      );
    }
  }
  const proxy = proxyFor(url.origin, env);
  return { siteUrl: url.origin, apiKey, locale, ...(proxy && { proxy }) };
}

/** The part of a key that is safe to show in logs and errors (CLAUDE.md §7). */
export function keyPrefix(key: string): string {
  return key.length <= 12 ? `${key.slice(0, 4)}…` : `${key.slice(0, 12)}…`;
}
