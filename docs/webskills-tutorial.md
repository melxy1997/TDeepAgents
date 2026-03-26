# TDeepAgents WebSkills 系统 — 详细设计与使用教程

本教程将详细介绍 WebSkills 系统的架构设计、核心原理，以及如何在你的 Web 应用中快速集成。

## 1. 什么是 WebSkills？

WebSkills 是 TDeepAgents 的核心端侧能力，它基于 **Model Context Protocol (MCP)** 官方标准，允许你将浏览器端的 JavaScript 函数注册为 AI 可直接调用的工具。

### 为什么选择 WebSkills？
- **端侧原力**：Agent 可以直接操作前端 UI 状态、DOM 或本地缓存。
- **协议标准化**：完全基于官方 `@modelcontextprotocol/sdk`，具备极强的兼容性与扩展性。
- **跨页面路由**：自研的 `PageToolBridge` 解决了 SPA 页面卸载后工具失效的问题。
- **零 LangChain 负载**：轻量级设计，完美适配浏览器与端侧模型。

---

## 2. 架构设计

WebSkills 系统由三大核心模块构成：

### A. WebRuntime (`@tdeepagents/web-runtime`)
运行在浏览器环境的 MCP Server 封装。
- **注册器**：管理工具定义与对应的 JS 处理函数。
- **传输层**：天然支持 `MessageChannel`（同页面/iFrame）、`SSE`（跨域/远程）和 `WebSocket`。
- **类型安全**：强制使用 Zod 进行参数校验，确保 LLM 输出的可靠性。

### B. PageToolBridge (页面工具桥)
专门解决 SPA 场景下的“局部工具”调用问题。
- **痛点**：在单页应用中，某些工具（如“提交订单”）只在特定页面加载时存在。
- **方案**：
  1. 桥接器维护一个 `工具 -> 路由` 的映射表。
  2. 当 Agent 调用一个未加载页面的工具时，桥接器自动通过导航函数跳转。
  3. 等待目标页面广播 `tda:page-ready` 后，通过 `postMessage` 转发指令。

### C. McpClientMiddleware (`@tdeepagents/middleware`)
运行在 Agent 侧的桥接中间件。
- **自动发现**：连接后自动拉取所有 MCP Server 的工具列表。
- **提示词注入**：将工具描述动态注入 Agent 的 System Prompt。
- **透明转发**：拦截匹配的工具调用请求，并通过 MCP 协议代理执行。

---

## 3. 快速上手

### 第一步：安装依赖
```bash
pnpm add @tdeepagents/web-runtime @tdeepagents/middleware zod
```

### 第二步：在 App 壳工程初始化
```typescript
import { WebSkillRuntime, withPageRouting, setNavigator } from '@tdeepagents/web-runtime';

// 1. 初始化并启用路由增强
const runtime = withPageRouting(new WebSkillRuntime({ name: 'my-app' }));

// 2. 设置你的路由跳转函数 (Vue/React 均可)
setNavigator((route) => router.push(route));

// 3. 连接传输层 (以 MessageChannel 为例)
const channel = new MessageChannel();
await runtime.connect(new MessageChannelTransport(channel.port1));
```

### 第三步：在具体页面注册逻辑 (如订单页)
```typescript
import { registerPageHandler } from '@tdeepagents/web-runtime';

onMounted(() => {
  const cleanup = registerPageHandler({
    route: '/orders',
    handlers: {
      cancel_order: async ({ orderId }) => {
        return await myApi.cancel(orderId);
      }
    }
  });
  onUnmounted(cleanup);
});
```

### 第四步：在 Agent 侧启用中间件
```typescript
import { McpClientMiddleware } from '@tdeepagents/middleware';

const middleware = new McpClientMiddleware({
  servers: {
    'web-client': { transport: channel.port2 }
  }
});

const agent = createDeepAgent({
  middleware: [middleware]
});
```

---

## 4. 进阶：原生工具 vs 路由工具

| 特性 | 原生技能 (Native) | 路由技能 (Routed) |
|---------|--------------|-------------------|
| **定义位置** | 全局 (App Shell) | 局部页面 (Component) |
| **生命周期** | 始终可用 | 随页面加载 |
| **典型场景** | 全局通知、状态查询 | 复杂的表单操作、局部 UI 交互 |
| **注册方式** | `runtime.registerSkill` | 带 `route` 参数的 `registerSkill` |

---

## 5. 最佳实践
- **类型校验**：尽量编写详尽的 Zod Schema，这不仅是为了安全，也有助于 LLM 更好地理解工具用途。
- **延迟处理**：跨页面路由会有一定的导航耗时，`PageToolBridge` 默认超时为 30s。
- **端侧适配**：当使用 Chrome Built-in AI 时，WebSkills 提供的“确定性工具”能显著提升 Agent 的执行成功率。
