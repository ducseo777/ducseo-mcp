# CLAUDE.md

> Ducseo MCP：让 AI 工具管理 Ducseo 外贸网站的 MCP server。主项目在 `D:\Nodes\Waibao_WB\Ducseo`，它的 CLAUDE.md 第 7 节是本项目的上游约定。

## 1. 定位

> 已实现（v0.2.1，对接 Agent API 1.3：写操作返回草稿预览链接 `previewUrl`，设置里可改统计代码 `analytics`）。开源许可证 MIT。

- 外贸公司在自己的 AI 工具（Claude Desktop、Claude Code、ChatGPT/Codex、Cursor、Grok Build 等）里添加这个 MCP，填上**站点地址**和 **API Key**（在网站后台 “AI Agent” 菜单创建），AI 就能管理网站内容。
- 本项目只是 Ducseo 站点 **Agent API**（`/api/agent/v1/*`）的客户端：把 API 包装成 AI 好用的 MCP 工具。**不含业务逻辑、不直连数据库**，所有校验和权限以站点为准。
- 运行在客户电脑上，通过 stdio 和 AI 工具通信。
- 开源放在 GitHub 上。

## 2. 技术栈

- TypeScript（`strict`），Node.js ≥ 20，ESM。
- `@modelcontextprotocol/sdk`（stdio 传输），`zod` 定义工具入参。
- HTTP 用 Node 自带的 `fetch`，不引入 axios 等依赖。依赖越少越好，安装要快。
- 用 tsup 打包成单文件 `dist/index.js`，`package.json` 里的 `bin` 指向它。**打包产物 `dist/` 提交进仓库**，客户从 GitHub 安装时不需要构建。
- MCP SDK 和 zod 都打进 `dist/index.js`，所以它们放在 `devDependencies`，包本身没有运行时依赖，`npx` 安装很快。不要加 `prepare` 脚本（从 git 安装时会触发构建）。
- 测试：Vitest（mock fetch），手动测试用 MCP Inspector。
- 包管理：pnpm。

## 3. 配置

通过环境变量传入（AI 工具的 MCP 配置里填）：

| 变量 | 必填 | 说明 |
|---|---|---|
| `DUCSEO_SITE_URL` | 是 | 站点地址，如 `https://www.example.com` |
| `DUCSEO_API_KEY` | 是 | 后台创建的 API Key（`dsk_` 开头） |
| `DUCSEO_LOCALE` | 否 | AI 默认操作的前台语言，不填则用站点默认语言 |

- 一个 MCP 实例只对应一个站点。管理多个站点就配多个实例，名字用 `ducseo-<客户名>`。
- 启动时校验配置，缺失或格式错误要给出清楚的报错（中英文）。

## 4. 启动流程

1. 读取配置。
2. 调 `GET /api/agent/v1/whoami`，拿到站点信息、API 版本、能力标记、启用的语言、当前 Key 的名称和 scopes。
3. API 版本不兼容时报错并提示升级 MCP 或联系开发者。
4. **按 scopes 注册工具**：Key 没有的权限，对应工具不注册（比如没有 `inquiries:read` 就不出现询盘工具），避免 AI 反复调用失败。
5. 区块类型不写死，`list_block_types` 实时从站点读取。

## 5. 工具

命名用 `snake_case` 的 动词_名词。每个工具注明需要的 scope。

- 身份：`whoami`（当前连接的站点、API 版本、Key 名称和权限；不需要额外 scope，任何有效 Key 都能调用）
- 站点：`get_site_overview`（站点信息、语言、内容统计，AI 应首先调用）、`get_content_guidelines`（品牌语气、公司事实库、写作规则）、`update_site_settings`、`update_navigation`
- 主题：`get_theme`、`update_theme`、`list_theme_presets`、`apply_theme_preset`、`import_design_md`（读取用户指定的本地 DESIGN.md 文件，交给站点按映射规则转换成主题；P1）。规则见主项目 `DESIGN.md` 第 2、11、12 节
- 分类：`list_categories`、`get_category`、`create_category`、`update_category`（含分类 SEO 文案）、`delete_category`
- 产品：`list_products`、`get_product`、`create_product`、`update_product`、`delete_product`
- 页面：`list_block_types`、`list_pages`、`get_page`、`create_page`、`update_page_blocks`
- 博客：`list_posts`、`get_post`、`create_post`、`update_post`
- 翻译：`list_missing_translations`、`upsert_translation`
- 媒体：`upload_media`（**本地文件路径**，可以直接上传客户电脑上的产品图、证书）、`upload_media_from_url`、`list_media`、`update_media_alt`
- SEO：`run_seo_check`、`list_redirects`、`upsert_redirect`
- 发布：`publish`、`list_revisions`、`revert_revision`
- 询盘：`list_inquiries`、`get_inquiry`
- 另外实现了：`get_settings`（读设置，改设置前先读）、`list_not_found`（404 记录，迁移旧站时配合 `upsert_redirect`）。
- `get_content_guidelines` 读主项目 `GET /guidelines`（公司事实库、品牌语气、写作和 SEO 规则，规则以站点为准）；`run_seo_check` 读 `GET /seo/check`（只查数据库内容，不抓网页）。
- `import_design_md` 只在 MCP 端实现：读取本地 .md 文件，连同映射规则（主项目 DESIGN.md 第 11 节，改规则时两边同步）、可选设计和字体、当前主题一起交给 AI；由 AI 判断映射，用户确认后再调 `apply_theme_preset` / `update_theme`。网站端不解析第三方 Markdown。

实现约定（已落地）：

- 每个工具是 `src/tools/define.ts` 的 `defineTool`：`requires` 写需要的权限，`capability` 写依赖的 whoami 能力标记；`src/server.ts` 的 `selectTools` 据此决定注册哪些工具。scope → 权限的映射在 `src/site.ts`，和主项目 `src/server/auth/actor.ts` 保持一致。
- 内容类工具：`create_*` 接收一种语言的字段 + 与语言无关的字段，`update_*` 用 PATCH（主项目按语言、按字段合并），其他语言用 `upsert_translation`。写操作统一返回 `savedSummary`（状态、前台链接、后台审核链接、说明）。
- 站点错误由 `runTool` 转成 `code + message + details` 加处理提示返回给 AI（`isError`），不抛给 SDK。
- 配置错误、Key 被拒、站点连不上、API 大版本不兼容时，server 仍然启动，只注册一个 `whoami`，返回中英文的原因和解决办法，让用户在对话里就能看到。

工具设计要求：

- 工具描述和参数说明用英文写（各家模型对英文的工具说明理解最稳定），写清楚字段含义、长度建议（如 meta description 120～160 字符）和使用时机。
- 返回给 AI 的内容要简洁、结构化；长列表分页，并告诉 AI 怎么翻页。
- 写操作返回改动摘要和草稿预览链接。
- 站点返回的错误原样转成 AI 能理解的提示（`code` + `message`），不要吞掉。

## 6. Server instructions（给 AI 的总指引）

在 MCP server 的 `instructions` 里写明：

- 开始工作前先调 `whoami` 确认站点和权限，再调 `get_site_overview` 和 `get_content_guidelines`。
- **不得编造公司数据**：认证、产能、成立年份、客户名等只能用公司事实库里的内容；缺了就问用户，不要猜。
- 文案面向海外 B2B 采购商，用目标语言地道表达，不要直译中文。
- 写 SEO 内容时遵守站点的关键词和长度要求；同一关键词不要堆砌。
- 改动默认是草稿（除非 Key 有 `content:publish` 权限且用户明确要求发布），完成后把预览链接给用户。

## 7. 安全

- **stdout 只用于 MCP 协议**，日志一律写 stderr。
- 任何日志、报错里都不能出现完整 API Key（只显示前缀）。
- `upload_media` 只读取用户指定的文件，检查类型和大小后再上传；不允许读取目录或递归上传。
- 只向 `DUCSEO_SITE_URL` 这一个域名发请求。

## 8. 兼容性

- 各客户站点独立部署，版本可能不同。MCP 要能对接所有仍在维护的站点版本：新工具依赖的接口，先看 `whoami` 返回的能力标记再决定是否注册。
- Agent API 只在 `v1` 内向后兼容扩展；MCP 的版本号遵循 semver，对接新的 API 大版本时升 MCP 大版本。

## 9. 分发

- **只通过 GitHub 分发**，不发布 npm，不做 `.mcpb` 扩展包。
- 客户的 AI 工具配置里用 `npx -y github:ducseo777/ducseo-mcp` 启动，环境变量填站点地址和 Key。客户电脑需要装 Node.js。
- 各客户端的配置写法（由站点后台 “AI Agent” 页面生成，和这里保持一致）：
  - Claude Desktop：`claude_desktop_config.json` 的 `mcpServers`
  - Claude Code：`claude mcp add` 命令或 `.mcp.json`
  - ChatGPT/Codex：`~/.codex/config.toml` 的 `[mcp_servers.<name>]`（`command`、`args`、`env`）
  - WorkBuddy：设置 → MCP → 添加 MCP Server，标准 `mcpServers` JSON（和 Cursor 相同；桌面端配置文件路径官方文档未写明，开发时核对）
  - Cursor：`mcp.json`
  - Grok Build：按其 MCP 配置格式（开发时核对）
- 发版用 git tag（`v1.2.0`），客户需要固定版本时可写 `github:ducseo777/ducseo-mcp#v1.2.0`。

## 10. 常用命令

```
pnpm install
pnpm dev          # tsup watch
pnpm build        # 改了 src 一定要重新 build 并提交 dist/
pnpm check        # tsc 类型检查
pnpm test         # Vitest，mock fetch
pnpm inspect      # 用 MCP Inspector 调试，需要设置 DUCSEO_SITE_URL / DUCSEO_API_KEY
```

本地联调：主项目 `pnpm dev` 后，在本地后台创建 Key，`DUCSEO_SITE_URL=http://localhost:4321`（只有 localhost 允许 http）。

## 11. 开发规范

- **和开发者交流一律用中文。**
- **每次 `git push` 前必须先经过开发者批准**，不能自行推送。commit 可以做，push 前先说明要推送哪些提交并等待确认。
- 代码、注释、提交信息用英文；README 提供中文和英文两版。
- 每个领域的工具放一个文件：`src/tools/{domain}.ts`；HTTP 客户端在 `src/client.ts`；配置在 `src/config.ts`。
- 新增工具前，先确认主项目的 Agent API 已经有对应接口。
- 不提交任何真实站点地址或 API Key；示例统一用 `https://www.example.com` 和 `dsk_live_xxxx`。
