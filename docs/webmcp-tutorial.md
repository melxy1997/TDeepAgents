# TDeepAgents WebMCP 技术教程

本教程介绍 **WebMCP**（Model Context Protocol for Web）的原生实现原理、技术规格以及如何在 TDeepAgents 框架中利用 **W3C 标准方案** 实现强大的端侧 AI 能力。

---

## 1. 什么是 WebMCP？

**WebMCP** (W3C 标准草案) 是浏览器提供的一种原生能力，旨在建立一套浏览器端的 Agent 工具调用标准。它允许网页通过简单的 API 向 AI Agent 声明自己的功能，而无需解析复杂的 DOM。

### 核心 API
- **`navigator.modelContext.registerTool(tool)`**：注册单个工具。
- **`navigator.modelContext.provideContext(options)`**：批量注册工具。

TDeepAgents 通过 `@tdeepagents/web-runtime` 完整实现了这一标准的 **Polyfill (Shim)**，确保在标准正式进入浏览器前，开发者就能享受标准化的开发体验。

---

## 2. 快速上手

### A. 初始化 WebMCP 环境
在你的应用入口（App Shell）中初始化运行时并注入 Shim：

```typescript
import { WebSkillRuntime, initWebMcpShim } from '@tdeepagents/web-runtime';

// 1. 创建运行时
const runtime = new WebSkillRuntime({ name: 'my-app' });

// 2. 注入 navigator.modelContext Polyfill
initWebMcpShim(runtime);

// 3. (可选) 连接传输层
await runtime.connect(new MessageChannelTransport(port));
```

### B. 使用标准 API 注册工具
现在，你可以在业务组件中直接使用标准的 `navigator.modelContext`：

```typescript
// 纯原生风格注册，无需依赖 TDeepAgents 的类
navigator.modelContext.registerTool({
  name: 'calculate_tax',
  description: '根据金额计算增值税',
  inputSchema: { 
    type: 'object', 
    properties: { 
      amount: { type: 'number' } 
    } 
  },
  execute: async ({ amount }) => {
    return { tax: amount * 0.13 };
  }
});
```

---

## 3. WebMCP 与 WebSkills 的关系

| 维度 | WebMCP (W3C 标准) | WebSkills (TDeepAgents 框架层) |
| --- | --- | --- |
| **API 风格** | `navigator.modelContext` | `runtime.registerSkill` |
| **关注点** | **互操作性** (跨框架/跨 Agent 通信) | **工程化** (路由跳转、渐进式加载、Zod 类型推导) |
| **底层实现** | `webmcp-shim.ts` | `web-skill-runtime.ts` + `PageToolBridge` |

> [!NOTE]
> 我们推荐在基础业务逻辑中使用 **WebMCP 原生 API** 以保证通用型；在需要深度集成 SPA 路由跳转时使用 **WebSkills 增强 API**。

---

## 4. 技术进阶：端侧模型闭环

WebMCP 是实现 **离线端侧 AI** 的最佳拍档。在 Chrome Built-in AI (Gemini Nano) 场景下：

1. **自动感知**：`McpClientMiddleware` 会自动通过 WebMCP 协议扫描 `navigator.modelContext` 中的工具。
2. **结构化指令**：即使端侧模型不支持内置的 Tool Calling，中间件也能将 WebMCP 的 JSON Schema 转换为 Prompt 约束。
3. **零网络调用**：所有的 `execute` 回调都在浏览器主线程运行，数据不出本地，实现极致的隐私与速度。

---

## 5. 开发者建议
- **JSON Schema**：原生 `registerTool` 使用 JSON Schema。如果你的项目使用 Zod，可以利用 `@tdeepagents/schemas` 中的 `zodToJsonSchema` 进行转换。
- **安全检查**：建议在 `execute` 处理器中检查 `origin` 或状态，防止非法调用。
