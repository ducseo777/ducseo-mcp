# Ducseo MCP

[中文](README.md)

Lets AI tools such as Claude, ChatGPT/Codex, Cursor and WorkBuddy manage a Ducseo B2B website: write product copy, build categories and pages, translate, upload product photos, and fill in SEO fields and alt text.

It runs on your own computer and talks to the site's Agent API. What the AI may do is set by the API key's permissions; by default every change is a draft that you review and publish in the dashboard.

## Setup

1. Install [Node.js](https://nodejs.org/) 20 or newer.
2. In the site dashboard open **AI Agent** → **Create API key** and pick the permissions. The page then shows ready-to-copy configuration for each AI tool, with the site address and key filled in.

## Manual configuration

JSON configuration (Claude Desktop, Cursor, WorkBuddy):

```json
{
  "mcpServers": {
    "ducseo-example": {
      "command": "npx",
      "args": ["-y", "github:ducseo777/ducseo-mcp"],
      "env": {
        "DUCSEO_SITE_URL": "https://www.example.com",
        "DUCSEO_API_KEY": "dsk_live_xxxx"
      }
    }
  }
}
```

- Claude Code: `claude mcp add ducseo-example --scope user --env DUCSEO_SITE_URL=https://www.example.com --env DUCSEO_API_KEY=dsk_live_xxxx -- npx -y github:ducseo777/ducseo-mcp`
- ChatGPT / Codex: under `[mcp_servers.ducseo-example]` in `~/.codex/config.toml` (`command`, `args`, `env`).
- On Windows, if `npx` is not found, use `"command": "cmd"` and put `"/c", "npx"` in front of `args`.

| Variable | Required | Meaning |
|---|---|---|
| `DUCSEO_SITE_URL` | yes | Site address, e.g. `https://www.example.com` |
| `DUCSEO_API_KEY` | yes | API key from the dashboard (starts with `dsk_`) |
| `DUCSEO_LOCALE` | no | Site language the AI works in by default; the site default if empty |

For several sites, add one MCP server per site with distinct names, e.g. `ducseo-abc`, `ducseo-xyz`.

To check the setup, ask the AI: "Call whoami and tell me which site you are connected to." If something is wrong, whoami explains what and how to fix it.

## Tools

Only the tools the key's permissions allow are offered.

| Area | Tools | Permission |
|---|---|---|
| Identity and overview | `whoami`, `get_site_overview` | none / `read` |
| Guidance and checks | `get_content_guidelines` (company facts, brand voice, writing rules), `run_seo_check` | `read` |
| Site settings | `get_settings`, `update_site_settings`, `update_navigation` | `read` / `settings:write` |
| Theme | `get_theme`, `list_theme_presets`, `update_theme`, `apply_theme_preset`, `import_design_md` (colors and fonts from a third-party DESIGN.md) | `read` / `settings:write` |
| Categories, products | `list_*`, `get_*`, `create_*`, `update_*`, `delete_*` | `read` / `content:draft` |
| Pages | `list_block_types`, `list_pages`, `get_page`, `create_page`, `update_page_blocks` | `read` / `content:draft` |
| Blog | `list_posts`, `get_post`, `create_post`, `update_post` | `read` / `content:draft` |
| Translation | `list_missing_translations`, `upsert_translation` | `read` / `content:draft` |
| Media | `upload_media` (local file), `upload_media_from_url`, `list_media`, `update_media_alt` | `media:write` / `read` |
| SEO | `list_redirects`, `list_not_found`, `upsert_redirect` | `read` / `content:publish` |
| Publishing and history | `publish`, `list_revisions`, `revert_revision` | `content:publish` / `read` / `content:draft` |
| Inquiries | `list_inquiries`, `get_inquiry` | `inquiries:read` |

## Security

- The key is only ever sent to `DUCSEO_SITE_URL`; logs show its prefix only.
- `upload_media` reads exactly the one file you name (JPEG, PNG, WebP, GIF, AVIF, PDF), never a directory.
- All validation and permission checks happen on the site; keys can be revoked in the dashboard at any time.

## License

[MIT](LICENSE)

## Development

```
pnpm install
pnpm build      # bundles dist/index.js (committed, so installs need no build)
pnpm test
pnpm check      # type check
pnpm inspect    # MCP Inspector; set DUCSEO_SITE_URL / DUCSEO_API_KEY first
```
