# TDeepAgents

> **TypeScript 原生 Deep Agent 框架 — 零 LangChain 依赖，全栈端侧 AI 架构**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Version](https://img.shields.io/badge/version-0.2.0-blue.svg)](./package.json)

**TDeepAgents** 是一个专为可移植性和类型安全设计的 AI Agent 框架。它在纯 TypeScript 环境下复刻了 [LangChain DeepAgents](https://github.com/langchain-ai/deepagents) 的全部核心能力（规划、子 Agent 委派、上下文管理），并在此基础上实现了基于标准 **MCP (Model Context Protocol)** 的 **WebSkills** 系统，和 **WebMCP** 支持，实现全栈端侧 AI 交互。

---

## 🔥 核心亮点

- **🚀 零 LangChain 依赖** — 轻量级、高性能，完全脱离 LangGraph/LangChain 的复杂堆栈。
- **💻 端侧 AI 体验** — 深度适配 **Chrome Built-in AI (Gemini Nano)**，支持离线运行，大幅提升响应速度与隐私安全性。
- **🌐 MCP 标准支持** — 完美集成官方 Model Context Protocol (MCP) SDK，让浏览器工具调用标准化。
- **✨ WebSkills & WebMCP** — 允许开发者将前端 JS 函数（如 `update_cart`, `scroll_to_element`）直接注册为 AI 可用的工具。
- **🛡️ Zod-First 类型安全** — 所有 Schema、工具输入、状态管理均通过 Zod 校验，提供端到端类型推导。
- **🧭 跨页面工具路由 (PageToolBridge)** — 独研的 SPA 跨页面调度能力，即使工具所在页面未加载，Agent 也能自动导航并完成调用。

---

---

## 🛠️ WebSkills & WebMCP

TDeepAgents v0.2.0 引入了全套浏览器工具调用方案，涵盖从底层协议到高阶工程化的完整链路：

### WebMCP (W3C 标准方案)
- **原生 API**：支持 `navigator.modelContext.registerTool()`，符合 W3C Web Machine Learning 工作组标准。
- **标准化通信**：基于官方 MCP 协议，可与任何标准 MCP Client 无缝对接。
- **Polyfill 支持**：提供 `initWebMcpShim`，在浏览器原生支持前即可使用标准 API 开发。

### WebSkills (TDeepAgents 增强)
- **渐进式披露**：支持按需加载 SKILL.md 文档，减少端侧模型处理不相关工具的压力。
- **跨路由调度 (PageToolBridge)**：解决了单页应用（SPA）中工具随组件销毁而失效的难题，支持自动路由跳转、页面就绪等待与工具转发。

> [!TIP]
> 立即查阅 [WebSkills 教程](./docs/webskills-tutorial.md) 与 [WebMCP 教程](./docs/webmcp-tutorial.md) 了解更多细节。

---

## 🏗️ 仓库结构

```text
packages/
├── core/         # Agent 引擎核心 (ReAct 循环, createDeepAgent)
├── web-runtime/  # 浏览器端 WebSkills 运行时与 MCP Server 实现
├── middleware/   # 中间件架构 (MCP Client, 自动总结, 记忆管理, HITL)
├── schemas/      # Zod 类型定义与 JSON Schema 转换工具
├── adapters/     # LLM 适配器 (OpenAI, Anthropic, Chrome Built-in AI)
├── backends/     # 数据持久化层 (State, Filesystem, Browser Storage)
└── tools/        # 内置系统工具 (Planning, Subagents, 执行器)
```

---

## 🚀 快速开始

### 1. 基础 Agent 设置
```typescript
import { createDeepAgent, FilesystemBackend } from '@tdeepagents/core';

const agent = createDeepAgent({
  model: 'openai:gpt-4o',
  backend: new FilesystemBackend({ rootDir: './workspace' }),
});

const { messages } = await agent.invoke({
  messages: [{ role: 'user', content: '分析当前项目结构' }],
});
```

### 2. 在浏览器中使用 (WebMCP、WebSkills)

**方案 A：使用 WebMCP 原生 API (推荐用于通用工具)**
```typescript
import { initWebMcpShim } from '@tdeepagents/web-runtime';

initWebMcpShim(runtime); // 注入 navigator.modelContext

navigator.modelContext.registerTool({
  name: 'get_cart_total',
  description: '获取购物车总额',
  inputSchema: { type: 'object', properties: {} },
  execute: async () => ({ total: 100 })
});
```

**方案 B：使用 WebSkills 增强 API (推荐用于 SPA 跨页场景)**
```typescript
import { WebSkillRuntime, withPageRouting } from '@tdeepagents/web-runtime';

const runtime = withPageRouting(new WebSkillRuntime());
runtime.registerSkill('get_user_info', {
  description: '获取用户详情',
  inputSchema: { id: z.string() },
  route: '/user-profile'
}, async (params) => { ... });
```

---

## 📖 深入文档

- 📘 [WebSkills 教程](./docs/webskills-tutorial.md) — 详细设计与使用方法、跨页面路由指引。
- 📙 [WebMCP 教程](./docs/webmcp-tutorial.md) — 底层协议原理、传输层适配与端侧 AI 闭环。
- 📐 [架构设计](./docs/architecture.md) — 核心设计原则与包依赖关系。
- 🧪 [可扩展性分析](./docs/extensibility.md) — 如何编写自定义适配器与中间件。
- 🗺️ [路线图](./docs/edge-roadmap.md) — 即将到来的特性：端侧向量检索、长短期记忆优化。

---

## 💻 本地开发

```bash
pnpm install
pnpm build      # 构建所有子包
pnpm test       # 运行测试用例
pnpm lint       # 代码规范检查
```

