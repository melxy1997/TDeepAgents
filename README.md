# TDeepAgents

> TypeScript-native deep agent framework — zero LangChain dependency

**TDeepAgents** 复刻了 [LangChain DeepAgents](https://github.com/langchain-ai/deepagents) 的全部核心能力（规划、文件系统、子 Agent 委派、上下文管理、人工介入），同时完全脱离 LangChain 生态，以 **Zod-first** 的方式提供类型安全保障。

## ✨ 核心亮点

- **零 LangChain 依赖** — 纯 TypeScript，无需引入 LangGraph/LangChain
- **Zod-first 类型系统** — 所有 schema 使用 Zod 定义，自动推导类型
- **可插拔架构** — LLM 适配器、Backend、中间件、工具均可独立替换
- **浏览器可运行** — `@tdeepagents/backends/browser` 入口，兼容 WebStorage/IndexedDB
- **端侧 AI 就绪** — Chrome Built-in AI 适配器架构已设计，支持通过结构化输出实现 prompt-based tool calling
- **WebMCP 就绪** — 工具定义格式与 WebMCP `ModelContextTool` 兼容

## 📦 包结构

```
packages/
├── schemas/      # Zod 类型定义 + zodToJsonSchema 工具
├── adapters/     # LLM 适配器 (OpenAI, Anthropic, 可扩展)
├── backends/     # 数据层协议 + 实现 (State, Filesystem, Composite)
├── tools/        # 内置工具 (planning, filesystem, execute, subagent)
├── middleware/   # 中间件 (Summarization, HITL, Skills, Memory)
└── core/         # Agent 引擎 (ReAct 循环, createDeepAgent)
```

## 🚀 快速开始

```typescript
import { createDeepAgent, FilesystemBackend } from '@tdeepagents/core';

const agent = createDeepAgent({
  model: 'openai:gpt-4o',
  backend: new FilesystemBackend({ rootDir: '.', virtualMode: true }),
  onStep: (event) => console.log(`[${event.type}]`, event.data),
});

const result = await agent.invoke({
  messages: [{ role: 'user', content: '分析当前目录下的代码结构' }],
});
```

## 📖 文档

- [架构设计](./docs/architecture.md) — 系统架构、包依赖、核心接口
- [可扩展性分析](./docs/extensibility.md) — 浏览器运行时、Chrome AI、WebMCP 适配方案
- [端侧特性路线图](./docs/edge-roadmap.md) — 即将支持的浏览器端特性

## 开发

```bash
pnpm install
pnpm run build     # 构建所有包
pnpm run test      # 运行测试
pnpm run lint      # Biome lint
```

## License

MIT
