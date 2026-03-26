# WebSkills 深度调研报告 & TDeepAgents 自研 WebSkills 扩展方案

> 基于 OpenTiny `next-sdk` (dev 分支) 源码的逐文件拆解分析

---

## 目录

- [第一部分：OpenTiny next-sdk 的 WebSkills 体系拆解](#第一部分opentiny-next-sdk-的-webskills-体系拆解)
  - [1. 全局架构概览](#1-全局架构概览)
  - [2. 三层架构详解](#2-三层架构详解)
    - [Layer 1: Skills 渐进式披露层](#layer-1-skills-渐进式披露层)
    - [Layer 2: WebMCP 标准通信层](#layer-2-webmcp-标准通信层)
    - [Layer 3: Page-Tools 跨页路由层](#layer-3-page-tools-跨页路由层)
  - [3. Agent 循环集成](#3-agent-循环集成)
  - [4. 端到端工作流](#4-端到端工作流)
  - [5. SKILL.md 文档规范](#5-skillmd-文档规范)
- [第二部分：标准 vs 私有 — 拆分分析](#第二部分标准-vs-私有--拆分分析)
- [第三部分：TDeepAgents 自研 WebSkills 扩展方案](#第三部分tdeepagents-自研-webskills-扩展方案)

---

## 第一部分：OpenTiny next-sdk 的 WebSkills 体系拆解

### 1. 全局架构概览

OpenTiny 的 WebSkills 体系**不是一个独立协议**，而是三层工程化封装的组合：

```
┌──────────────────────────────────────────────────────────────────┐
│                      用户的前端应用                                │
│                                                                  │
│   ┌────────────────┐    ┌───────────────┐    ┌────────────────┐  │
│   │  Layer 1       │    │  Layer 2      │    │  Layer 3       │  │
│   │  Skills        │    │  WebMCP       │    │  Page-Tools    │  │
│   │  渐进式披露     │    │  标准通信      │    │  跨页路由       │  │
│   │                │    │               │    │                │  │
│   │  SKILL.md      │    │ WebMcpServer  │    │   bridge.ts    │  │
│   │  frontmatter   │    │ WebMcpClient  │    │  postMessage   │  │
│   │  get_skill_    │    │ Transport     │    │  setNavigator  │  │
│   │  content tool  │    │               │    │  registerPage  │  │
│   └────────────────┘    └───────────────┘    └────────────────┘  │
│           │                     │                     │          │
│           ▼                     ▼                     ▼          │
│   ┌──────────────────────────────────────────────────────────┐   │
│   │             AgentModelProvider                            │   │
│   │        (ai-sdk streamText / generateText loop)           │   │
│   └──────────────────────────────────────────────────────────┘   │
│                              │                                    │
└──────────────────────────────┼────────────────────────────────────┘
                               ▼
                    ┌─────────────────┐
                    │   WebAgent 服务  │
                    │   (AI + LLM)    │
                    └─────────────────┘
```

**源码核心文件映射表：**

| 文件 | 角色 | 依赖关系 |
| :--- | :--- | :--- |
| `skills/index.ts` | Skills 渐进式披露核心 | 依赖 `ai` (Vercel AI SDK), `zod` |
| `WebMcpServer.ts` | MCP Server 封装 | 依赖 `@modelcontextprotocol/sdk` |
| `WebMcpClient.ts` | MCP Client 封装 | 依赖 `@modelcontextprotocol/sdk` |
| `page-tools/bridge.ts` | 跨页面工具路由 | 依赖 `WebMcpServer`, `zod`, `window.postMessage` |
| `agent/AgentModelProvider.ts` | Agent 循环引擎 | 依赖 `ai` SDK, MCP Client, WebMcpClient |
| `agent/utils/getAISDKTools.ts` | MCP Tool → AI SDK Tool 转换 | 依赖 `ai`, `WebMcpClient` |
| `next-remoter useSkill.ts` | Vue Composable 集成胶水 | 依赖 `skills/index.ts` |

---

### 2. 三层架构详解

#### Layer 1: Skills 渐进式披露层

**源文件：** `packages/next-sdk/skills/index.ts` (269 行)

**核心理念：** SKILL.md 文档即为「技能」的全部声明。Agent 初始化时只看到一行摘要，按需再读全文。

##### 数据结构

```typescript
interface SkillMeta {
  name: string        // 技能名称，与 skill 目录名一致
  description: string // 技能描述，用于 systemPrompt
  path: string        // 主 SKILL.md 相对路径，如 ./calculator/SKILL.md
}
```

##### 文件组织约定

```
skills/
├── orders/
│   └── SKILL.md           ← 主入口（frontmatter + 业务指引）
├── price-protection/
│   └── SKILL.md
├── inventory/
│   ├── SKILL.md
│   └── reference/
│       └── stock-rules.md ← 附属参考文档
└── calculator/
    └── SKILL.md
```

- **主 SKILL.md 路径识别规则**：正则 `/^\.\/[^/]+\/SKILL\.md$/`，即一级子目录下的 `SKILL.md`。
- **附属文档**：主 SKILL.md 可以通过相对路径引用 `./reference/xxx.md`，Agent 通过 `get_skill_content` 工具按路径加载。

##### 关键函数

| 函数 | 作用 |
| :--- | :--- |
| `parseSkillFrontMatter(content)` | 从 YAML frontmatter 中正则提取 `name`、`description` |
| `normalizeSkillModuleKeys(modules)` | 将 Vite `import.meta.glob` 的各种路径格式统一为相对路径 |
| `getSkillOverviews(modules)` | 扫描所有主 SKILL.md，返回 `SkillMeta[]` 列表 |
| `formatSkillsForSystemPrompt(skills)` | 将 overview 格式化为 systemPrompt 文本段 |
| `getSkillMdContent(modules, path)` | 按路径查找具体文档内容（支持严格匹配 + 后缀降级匹配） |
| `getMainSkillPathByName(modules, name)` | 按技能名查找主 SKILL.md 路径（目录名匹配 + frontmatter name 匹配） |
| `createSkillTools(modules)` | **核心**：创建 `get_skill_content` AI SDK 工具 |

##### `get_skill_content` 工具实现

这是整个 Skills 层的核心：一个注入给 LLM 的 AI SDK `tool()`，让大模型在需要时主动调用来加载技能文档。

**输入参数 (Zod Schema)：**

```typescript
z.object({
  skillName: z.string().optional()
    .describe('进入某个技能的主入口名称'),
  path: z.string().optional()
    .describe('想查阅的文档路径，如 ./calculator/SKILL.md'),
  currentPath: z.string().optional()
    .describe('当前正在阅读的文档路径（用于相对路径解析）')
})
```

**解析逻辑（3 层降级匹配）：**

1. **严格路径匹配** — 直接在 normalized modules 中查找
2. **相对路径回退** — 如果 LLM 传的 `currentPath` 错误，尝试从 skill 根目录解析
3. **后缀降级匹配** — 去除前缀后按 endsWith 模糊匹配

##### 端到端流转

```
初始化阶段：
  Vite import.meta.glob('./skills/**/*.md') → Record<path, content>
  ↓
  getSkillOverviews() → SkillMeta[]
  ↓
  formatSkillsForSystemPrompt() → "## 可用技能\n- **订单管理**: 帮助查询订单...\n"
  ↓
  拼入 Agent 的 systemPrompt

运行时阶段（LLM 按需加载）：
  用户："帮我查一下张三的订单"
  ↓
  LLM 判断需要「订单管理」技能
  ↓
  LLM 调用 get_skill_content({ skillName: '订单管理助手' })
  ↓
  返回完整 SKILL.md 内容（含工作流、可用工具列表、业务规则）
  ↓
  LLM 按 SKILL.md 中的指引执行后续 MCP 工具调用
```

---

#### Layer 2: WebMCP 标准通信层

**源文件：** `WebMcpServer.ts` (448 行), `WebMcpClient.ts` (505 行)

**核心发现：两者都是 `@modelcontextprotocol/sdk` 官方 SDK 的薄封装，无自定义协议。**

##### WebMcpServer

```typescript
export class WebMcpServer {
  public readonly server: McpServer  // ← 直接使用官方 McpServer

  constructor(serverInfo?, options?) {
    this.server = new McpServer(serverInfo || info, options || { capabilities })
  }

  // 所有方法直接透传到 this.server
  registerTool(name, config, cb) {
    return this.server.registerTool(name, config, cb)
  }
}
```

**额外能力：**
- 支持 `MessageChannelServerTransport`（浏览器环境 postMessage 通信）
- 支持 `pagehide` 事件自动关闭连接（SPA 场景）
- 提供 `createMessageChannelPairTransport()` 创建 server↔client 通信对

##### WebMcpClient

```typescript
export class WebMcpClient {
  public readonly client: Client  // ← 直接使用官方 MCP Client

  async connect(options: Transport | ClientConnectOptions) {
    // 支持 4 种 transport: channel / sse / stream / socket
    // 支持 agent 模式: createStreamProxy / createSseProxy / createSocketProxy
  }
}
```

**Transport 支持矩阵：**

| Transport 类型 | 适用场景 | 来源 |
| :--- | :--- | :--- |
| `MessageChannelClientTransport` | 浏览器内同页通信 | `@opentiny/next` |
| `SSEClientTransport` | Server-Sent Events | `@modelcontextprotocol/sdk` |
| `StreamableHTTPClientTransport` | HTTP Streamable | `@modelcontextprotocol/sdk` |
| `WebSocketClientTransport` | WebSocket | `@modelcontextprotocol/sdk` |
| `ExtensionClientTransport` | 浏览器扩展通信 | 自定义 |

##### 工具注册示例

```typescript
server.registerTool('order_query', {
  title: '订单查询',
  description: '查询订单列表',
  inputSchema: {
    customerName: z.string().optional().describe('客户姓名'),
    status: z.enum(['Pending','Shipped','Delivered','Refunded','Cancelled']).optional()
  }
}, async (params) => {
  const results = await queryOrders(params)
  return { content: [{ type: 'text', text: JSON.stringify(results) }] }
})
```

---

#### Layer 3: Page-Tools 跨页路由层

**源文件：** `page-tools/bridge.ts` (517 行), `page-tools/effects.ts`

**解决的问题：** 在 SPA 中，不同路由页面的工具定义分散在各自页面组件中。当 LLM 需要调用某页面的工具时，该页面可能尚未加载。

##### 核心机制

```
LLM 调用 order_query
  ↓
  withPageTools 代理检查 route 映射 → /orders
  ↓
  activePages.has('/orders') ?
  ├── 是 → 直接 postMessage 发送调用
  └── 否 → _navigator('/orders') 触发路由跳转
             ↓
             等待 page-ready 信号 (postMessage)
             ↓
             postMessage 发送工具调用
  ↓
  目标页面 registerPageTool 的 handler 处理
  ↓
  postMessage 回传结果
```

##### 关键 API

| 函数 | 作用 |
| :--- | :--- |
| `setNavigator(fn)` | 注册路由跳转函数（如 `router.push`） |
| `withPageTools(server)` | 用 Proxy 包装 WebMcpServer，使 `registerTool` 支持 `RouteConfig` |
| `registerPageTool({route, handlers})` | 在目标页面激活工具处理器，返回 cleanup 函数 |
| `registerNavigateTool(server)` | 注册通用的 `navigate_to_page` 工具 |

##### RouteConfig 类型

```typescript
type RouteConfig = {
  route: string           // 目标路由路径
  timeout?: number        // 超时时间 (默认 30000ms)
  invokeEffect?: boolean | ToolInvokeEffectConfig  // 调用提示效果
}
```

##### 消息协议（window.postMessage）

| 消息类型 | 方向 | 含义 |
| :--- | :--- | :--- |
| `next-sdk:tool-call` | bridge → 目标页面 | 工具调用请求 |
| `next-sdk:tool-response` | 目标页面 → bridge | 工具调用结果 |
| `next-sdk:page-ready` | 目标页面 → bridge | 页面已激活 |
| `next-sdk:page-leave` | 目标页面 → bridge | 页面已卸载 |
| `next-sdk:remoter-ready` | iframe Remoter → 父窗口 | Remoter 就绪 |

---

### 3. Agent 循环集成

**源文件：** `agent/AgentModelProvider.ts` (881 行), `agent/utils/getAISDKTools.ts`

##### AgentModelProvider

这是 next-sdk 的 Agent 引擎，封装了完整的 LLM 对话循环：

```typescript
class AgentModelProvider {
  llm: ProviderV2          // AI SDK 的 LLM Provider
  mcpServers: Record<...>  // MCP Server 配置集合
  mcpClients: Record<...>  // MCP Client 实例集合
  mcpTools: Record<...>    // 从所有 Client 聚合的 tools

  async initClientsAndTools()     // 初始化所有连接并获取 tools
  async insertMcpServer(name, config) // 动态新增 MCP Server
  async removeMcpServer(name)     // 动态移除 MCP Server
  _tempMergeTools(extraTools)     // 合并 MCP tools + extraTools (含 skill tools)
}
```

##### getAISDKTools — MCP→AI SDK 转换器

```typescript
const getAISDKTools = async (client: WebMcpClient): Promise<ToolSet> => {
  const listToolsResult = await client.listTools()

  for (const { name, description, inputSchema } of listToolsResult.tools) {
    tools[name] = dynamicTool({
      description,
      inputSchema: jsonSchema({ ...inputSchema }),
      execute: (args, options) => client.callTool({ name, arguments: args })
    })
  }
}
```

##### useSkill — Vue Composable 胶水层

**源文件：** `next-remoter/src/composable/useSkill.ts`

将 Skills 层与 Agent 引擎粘合的地方：

```typescript
function useSkillWithTools({ skillsRef, customAgentProvider }) {
  // 1. 计算技能概况
  const skillOverviews = computed(() => getSkillOverviews(skillsRef.value))

  // 2. 格式化 systemPrompt 片段
  const skillPromptPart = computed(() => formatSkillsForSystemPrompt(skillOverviews.value))

  // 3. 创建 get_skill_content 工具
  const skillTools = computed(() => createSkillTools(skillsRef.value))

  // 4. 注入到 Agent
  watchEffect(() => {
    customAgentProvider.promptManager.setSkillMeta(skillPromptPart.value)
    customAgentProvider.llmConfig.extraTools = { ...extra, ...skillTools.value }
  })
}
```

---

### 4. 端到端工作流

以「用户请求价保」为例的完整调用链：

```
1. 应用启动
   └→ Vite import.meta.glob('./skills/**/*.md') 加载所有 SKILL.md
   └→ useSkillWithTools() 注入 systemPrompt + get_skill_content 工具
   └→ WebMcpServer.registerTool() 注册业务工具 (order_query, add_price_protection, ...)
   └→ withPageTools() 包装，为跨页工具配置 RouteConfig

2. 用户输入: "帮我给张三做个价保"
   └→ Agent 收到消息，systemPrompt 中有可用技能列表
   └→ LLM 识别到需要「价保」技能
   └→ LLM 调用 get_skill_content({ skillName: '客户价保单创建及审核' })
   └→ 返回完整 SKILL.md (含工作流、规则、工具列表)

3. LLM 按 SKILL.md 工作流执行:
   └→ 步骤1: 调用 navigate_to_page({ path: '/orders' })
       └→ bridge.ts: setNavigator → router.push('/orders')
       └→ 等待 page-ready 信号
   └→ 步骤2: 调用 order_query({ customerName: '张三' })
       └→ bridge.ts: postMessage → 订单页面 handler → 返回结果
   └→ 步骤3: 调用 navigate_to_page({ path: '/price-protection' })
   └→ 步骤4: 调用 add_price_protection({ orderId, amount, reason })

4. Agent 整理结果返回给用户
```

---

### 5. SKILL.md 文档规范

通过分析 11 个示例 SKILL.md，总结出文档规范：

##### Frontmatter 字段

```yaml
---
name: 订单管理助手          # 必填：技能名称
description: 帮助查询订单... # 必填：简短描述（供 systemPrompt 使用）
license: MIT               # 可选：许可证
metadata:
  version: '1.0.0'         # 可选：扩展元数据
---
```

##### Body 结构

```markdown
# 技能标题

角色定位说明（你是……的助手）。

## 可用工具

- `tool_name_1`: 工具描述
- `tool_name_2`: 工具描述

## 业务规则

1. 规则 1
2. 规则 2

## 工作流（你的执行步骤）

1. 第一步：……
2. 第二步：……
```

> [!IMPORTANT]
> SKILL.md 的本质是给 LLM 的「行为指南」，它不包含代码，而是用自然语言描述 LLM 应该调用哪些工具、什么顺序、什么条件。

---

## 第二部分：标准 vs 私有 — 拆分分析

| 能力 | 是否标准 | 标准名 | OpenTiny 私有部分 | TDeepAgents 策略 |
| :--- | :--- | :--- | :--- | :--- |
| **MCP 协议** | ✅ 标准 | Model Context Protocol (Anthropic) | 无，直接使用 `@modelcontextprotocol/sdk` | 直接对接标准 MCP SDK |
| **MCP Server/Client API** | ✅ 标准 | `McpServer`, `Client` | 薄封装 `WebMcpServer`/`WebMcpClient` | 自研薄封装 |
| **MCP Transport** | ✅ 标准 | SSE / HTTP Streamable / WebSocket | `MessageChannelTransport` (浏览器专用) | 按需实现浏览器 Transport |
| **SKILL.md Frontmatter** | ⚠️ 准标准 | Agent Skills Specification | 目录约定（`./skillName/SKILL.md`） | **已实现**，可复用 |
| **get_skill_content 工具** | ❌ 私有 | — | OpenTiny 自定义的 AI SDK tool | **自研替代** |
| **渐进式披露 systemPrompt 注入** | ❌ 私有 | — | `formatSkillsForSystemPrompt` | **自研替代** |
| **Page-Tools 跨页路由** | ❌ 私有 | — | `bridge.ts`, `postMessage` 协议 | **自研替代** |
| **useSkill Vue Composable** | ❌ 私有 | — | Vue 3 专用 | 不需要，TDeepAgents 框架无关 |
| **AgentModelProvider** | ❌ 私有 | — | AI SDK 封装 + ReAct 模式 | 不需要，TDeepAgents 有自己的 Agent 循环 |

**结论：** OpenTiny 的 WebSkills 中，**真正有价值且需要自研的核心能力有 3 个**：

1. **Skills 渐进式披露**（已有基础 → 扩展）
2. **MCP Client Middleware**（新增）
3. **Page-Tools 跨页工具路由**（新增，浏览器场景专用）

---

## 第三部分：TDeepAgents 自研 WebSkills 扩展方案

### 3.1 设计原则

1. **只依赖标准**：MCP 协议 (`@modelcontextprotocol/sdk`) + Agent Skills Spec
2. **与 OpenTiny 解耦**：不引入 `@opentiny/next-sdk`
3. **在现有架构上扩展**：复用已有的 `SkillsMiddleware`、`BackendProtocol`、`ToolCall/ToolResult` schema
4. **渐进式**：新增能力不破坏既有 SKILL.md 格式

### 3.2 能力扩展矩阵

```
现有 TDeepAgents 能力                        新增 WebSkills 能力
┌─────────────────────────┐            ┌─────────────────────────┐
│  SkillsMiddleware       │            │  McpClientMiddleware    │ ← 新增
│  - SKILL.md 解析         │            │  - 连接 MCP Server      │
│  - 渐进式披露            │ ──扩展──→   │  - Tool 发现 & 代理      │
│  - SkillBundle          │            │  - Transport 抽象       │
│  - URL 安装              │            └─────────────────────────┘
└─────────────────────────┘            ┌─────────────────────────┐
┌─────────────────────────┐            │  WebSkillRuntime        │ ← 新增
│  BackendProtocol        │            │  - 浏览器环境 Skill 注册 │
│  - read / write / ls    │            │  - postMessage 桥接     │
│  - grep / glob          │            │  - 页面生命周期管理      │
└─────────────────────────┘            └─────────────────────────┘
```

### 3.3 新增包/模块设计

#### (A) `McpClientMiddleware` — MCP 客户端中间件

**位置：** `packages/middleware/src/mcp-client.ts`

**职责：** 连接外部 MCP Server（包括浏览器内的 WebMcpServer），自动将 MCP tools 转换为 TDeepAgents 的内部工具格式。

```typescript
interface McpClientConfig {
  /** MCP Server 连接配置 */
  servers: Record<string, {
    transport: 'sse' | 'streamable-http' | 'websocket' | 'in-memory'
    url?: string
    // 或直接传入 Transport 实例
    transportInstance?: Transport
  }>
}

class McpClientMiddleware implements Middleware {
  name = 'mcp-client'

  async beforeAgent(state, runtime) {
    // 1. 连接所有 MCP Server
    // 2. 调用 listTools() 获取工具列表
    // 3. 将 MCP tools 转换为 TDeepAgents ToolCall 格式
    // 4. 注入 system prompt 中的工具声明
  }

  async afterToolCall(toolCall, runtime) {
    // 拦截 MCP 工具调用，通过 MCP Client 转发执行
  }
}
```

**与 SkillsMiddleware 的关系：**

```
SkillsMiddleware  →  提供 SKILL.md 文档层（指引 LLM 行为）
McpClientMiddleware → 提供 MCP 工具层（实际可调用的函数）
```

两者可以独立使用，也可以配合使用：SKILL.md 中描述的工具名指向 MCP Server 中注册的工具。

#### (B) `WebSkillRuntime` — 浏览器端技能运行时

**位置：** `packages/web-runtime/src/` (新包)

**职责：** 在浏览器环境中，将前端业务函数注册为可被 AI 调用的标准 MCP 工具。

```typescript
class WebSkillRuntime {
  private mcpServer: McpServer  // 使用标准 MCP SDK

  /** 注册一个 WebSkill（业务函数 → MCP Tool） */
  registerSkill<T extends ZodRawShape>(
    name: string,
    config: {
      description: string
      inputSchema: T
      /** 目标路由（SPA 跨页场景） */
      route?: string
    },
    handler: (params: z.infer<ZodObject<T>>) => Promise<unknown>
  ): void

  /** 连接到 Agent */
  connect(transport: Transport): Promise<void>

  /** 获取内部 MCP Server（供高级用法） */
  getServer(): McpServer
}
```

**页面工具桥接（可选）：**

```typescript
class PageToolBridge {
  /** 注册路由导航器 */
  setNavigator(fn: (route: string) => Promise<void>): void

  /** 在目标页面激活工具处理器 */
  registerPageHandler(options: {
    route?: string
    handlers: Record<string, (input: unknown) => Promise<unknown>>
  }): () => void  // 返回 cleanup

  /** 包装 WebSkillRuntime，使 registerSkill 支持跨页路由 */
  withPageRouting(runtime: WebSkillRuntime): WebSkillRuntime
}
```

#### (C) 扩展 `SkillsMiddleware` — 支持 WebSkill 元数据

在现有 SKILL.md frontmatter 中新增可选字段：

```yaml
---
name: order-management
description: 订单管理技能
# --- 新增 WebSkill 字段 ---
web-skill: true                    # 标记为 WebSkill
mcp-server: ecommerce-server       # 关联的 MCP Server 名
route: /orders                     # 关联的前端路由
tools:                             # 声明本技能使用的 MCP 工具
  - order_query
  - order_detail
---
```

`SkillsMiddleware` 解析到 `web-skill: true` 时，会将工具信息传递给 `McpClientMiddleware`，实现两层的自动打通。

### 3.4 使用示例

#### 场景 1：纯 Node.js Agent 连接远程 MCP Server

```typescript
import { Agent } from '@tdeepagents/core'
import { SkillsMiddleware } from '@tdeepagents/middleware'
import { McpClientMiddleware } from '@tdeepagents/middleware'

const agent = new Agent({
  middleware: [
    new SkillsMiddleware(['./.agents/skills/']),
    new McpClientMiddleware({
      servers: {
        'weather-api': {
          transport: 'sse',
          url: 'https://weather-mcp.example.com/sse'
        }
      }
    })
  ]
})
```

#### 场景 2：浏览器端 — 业务应用暴露工具给 Agent

```typescript
import { WebSkillRuntime } from '@tdeepagents/web-runtime'
import { z } from 'zod'

const runtime = new WebSkillRuntime()

// 注册业务函数为 WebSkill
runtime.registerSkill('search_flights', {
  description: '搜索航班',
  inputSchema: {
    origin: z.string().describe('出发城市'),
    dest: z.string().describe('目的城市'),
    date: z.string().describe('出发日期 YYYY-MM-DD')
  }
}, async ({ origin, dest, date }) => {
  const flights = await flightAPI.search({ origin, dest, date })
  return { content: [{ type: 'text', text: JSON.stringify(flights) }] }
})

// 通过 MessageChannel 连接到 Agent
const [serverTransport, clientTransport] = createTransportPair()
await runtime.connect(serverTransport)
```

#### 场景 3：SPA 跨页工具路由

```typescript
import { WebSkillRuntime, PageToolBridge } from '@tdeepagents/web-runtime'

const bridge = new PageToolBridge()
bridge.setNavigator((route) => router.push(route))

const runtime = bridge.withPageRouting(new WebSkillRuntime())

// 注册时指定 route，工具调用时自动跳转
runtime.registerSkill('order_query', {
  description: '查询订单',
  inputSchema: { ... },
  route: '/orders'  // ← 指定目标路由
}, handler)
```

### 3.5 实现优先级路线图

| 优先级 | 模块 | 依赖 | 预估工作量 |
| :--- | :--- | :--- | :--- |
| **P0** | `McpClientMiddleware` | `@modelcontextprotocol/sdk` | 2-3 天 |
| **P1** | `WebSkillRuntime` (基础版) | `@modelcontextprotocol/sdk` | 2-3 天 |
| **P1** | `SkillsMiddleware` 扩展 (web-skill 字段) | 现有代码 | 1 天 |
| **P2** | `PageToolBridge` (跨页路由) | `WebSkillRuntime` | 2 天 |
| **P2** | Transport 扩展 (MessageChannel) | MCP SDK | 1 天 |
| **P3** | 示例 & 文档 | 全部模块 | 2 天 |

### 3.6 与标准的对齐关系

```
┌─────────────────────────────────────────────────────────────────┐
│                        标准层                                    │
│  ┌──────────────────────┐    ┌────────────────────────────────┐ │
│  │   Agent Skills Spec  │    │  Model Context Protocol (MCP)  │ │
│  │   SKILL.md 格式       │    │  JSON-RPC / Transport          │ │
│  └──────────────────────┘    └────────────────────────────────┘ │
└───────────────┬──────────────────────────┬──────────────────────┘
                │                          │
                ▼                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                    TDeepAgents 自研层                             │
│  ┌──────────────────────┐    ┌────────────────────────────────┐ │
│  │  SkillsMiddleware    │    │  McpClientMiddleware           │ │
│  │  (已有 + 扩展)        │    │  (新增)                        │ │
│  └──────────────────────┘    └────────────────────────────────┘ │
│  ┌──────────────────────┐    ┌────────────────────────────────┐ │
│  │  WebSkillRuntime     │    │  PageToolBridge               │ │
│  │  (新增, 浏览器端)     │    │  (新增, 跨页路由)              │ │
│  └──────────────────────┘    └────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

> [!TIP]
> 与 OpenTiny next-sdk 的本质区别在于：我们**不创建新的私有 API 层**（如 `createSkillTools`），而是让每一层都直接对接标准。技能文档走 Agent Skills Spec，工具注册和调用走 MCP 协议。两个标准之间通过 `SkillsMiddleware` 的扩展字段自动桥接。
