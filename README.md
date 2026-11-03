# Ducseo MCP

[English](README.en.md)

让 Claude、ChatGPT/Codex、Cursor、WorkBuddy 等 AI 工具直接管理你的 Ducseo 外贸网站：写产品文案、建分类和页面、翻译、上传产品图、补 SEO 和 alt 文本。

它运行在你自己的电脑上，通过网站的 Agent API 工作。AI 能做什么由 API Key 的权限决定，默认所有改动都是草稿，由你在后台确认后再发布。

## 准备

1. 电脑安装 [Node.js](https://nodejs.org/) 20 或更高版本。
2. 登录网站后台 → **AI Agent** → **创建 API Key**，选择权限。创建后页面会直接给出各个 AI 工具的安装配置，网站地址和 Key 已经填好，复制即可。

## 手动配置

以 Claude Desktop、Cursor、WorkBuddy 的 JSON 配置为例：

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

- Claude Code：`claude mcp add ducseo-example --scope user --env DUCSEO_SITE_URL=https://www.example.com --env DUCSEO_API_KEY=dsk_live_xxxx -- npx -y github:ducseo777/ducseo-mcp`
- ChatGPT / Codex：写在 `~/.codex/config.toml` 的 `[mcp_servers.ducseo-example]` 下（`command`、`args`、`env`）。
- Windows 上如果提示找不到 `npx`，把 `"command": "npx"` 改成 `"command": "cmd"`，`args` 前面加上 `"/c", "npx"`。

| 环境变量 | 必填 | 说明 |
|---|---|---|
| `DUCSEO_SITE_URL` | 是 | 网站地址，例如 `https://www.example.com` |
| `DUCSEO_API_KEY` | 是 | 后台创建的 API Key（`dsk_` 开头） |
| `DUCSEO_LOCALE` | 否 | AI 默认使用的前台语言，不填就用网站默认语言 |
| `DUCSEO_PROXY` | 否 | HTTP 代理地址，例如 `http://127.0.0.1:7890`（代理软件的 HTTP 端口，不支持 SOCKS）。在国内经常出现 `network_error` 时填写。不填时会读取 `HTTPS_PROXY` / `ALL_PROXY` |

管理多个网站就添加多个 MCP，名字区分开，比如 `ducseo-abc`、`ducseo-xyz`。

安装后对 AI 说“调用 whoami，告诉我连接的是哪个网站”，能返回网站名称就说明成功了。连接有问题时，whoami 会说明原因和解决办法。

## 能做什么

只会出现 Key 权限允许的工具。

| 领域 | 工具 | 需要的权限 |
|---|---|---|
| 身份与概览 | `whoami`、`get_site_overview` | 无 / `read` |
| 写作指引与检查 | `get_content_guidelines`（公司事实库、品牌语气、写作规则）、`run_seo_check` | `read` |
| 站点设置 | `get_settings`、`update_site_settings`、`update_navigation` | `read` / `settings:write` |
| 主题 | `get_theme`、`list_theme_presets`、`update_theme`、`apply_theme_preset`、`import_design_md`（按第三方 DESIGN.md 调整配色和字体） | `read` / `settings:write` |
| 分类、产品 | `list_*`、`get_*`、`create_*`、`update_*`、`delete_*` | `read` / `content:draft` |
| 页面 | `list_block_types`、`list_pages`、`get_page`、`create_page`、`update_page_blocks`、`update_page_block`、`add_page_block`、`remove_page_block` | `read` / `content:draft` |
| 博客 | `list_posts`、`get_post`、`create_post`、`update_post` | `read` / `content:draft` |
| 翻译 | `list_missing_translations`、`upsert_translation` | `read` / `content:draft` |
| 媒体 | `upload_media`（电脑上的文件）、`upload_media_from_url`、`list_media`、`update_media_alt` | `media:write` / `read` |
| SEO | `list_redirects`、`list_not_found`、`upsert_redirect` | `read` / `content:publish` |
| 发布与版本 | `publish`、`list_revisions`、`revert_revision` | `content:publish` / `read` / `content:draft` |
| 询盘 | `list_inquiries`、`get_inquiry` | `inquiries:read` |

## 安全

- Key 只发送到 `DUCSEO_SITE_URL` 这一个网站，日志里只显示前缀。
- `upload_media` 只读取你指定的单个文件（JPEG、PNG、WebP、GIF、AVIF、PDF），不读目录。
- 所有校验和权限检查都在网站端完成；Key 可以在后台随时吊销。

## 许可证

[MIT](LICENSE)

## 开发

```
pnpm install
pnpm build      # 打包成 dist/index.js（提交进仓库，安装时不需要构建）
pnpm test
pnpm check      # 类型检查
pnpm inspect    # 用 MCP Inspector 调试，需要先设置 DUCSEO_SITE_URL / DUCSEO_API_KEY
```
