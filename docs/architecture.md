# 架构设计

## 设计理念

TDeepAgents 遵循 **关注点分离** 和 **面向接口编程** 原则，4 个核心 interface 将系统解耦为独立可替换的模块：

```
┌─────────────────────────────────────────────────────┐
│                 createDeepAgent()                     │
│                                                       │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │ LLMAdapter   │  │ BackendProto │  │ Middleware[]  │ │
│  │              │  │              │  │              │ │
│  │ • chat()     │  │ • lsInfo()   │  │ • beforeAgent│ │
│  │ • stream()   │  │ • read()     │  │ • afterAgent │ │
│  │ • countTok() │  │ • write()    │  │ • wrapTool() │ │
│  └──────┬───────┘  │ • edit()     │  └───────┬──────┘ │
│         │          │ • grepRaw()  │          │        │
│  ┌──────┴───────┐  │ • globInfo() │  ┌───────┴──────┐ │
│  │ OpenAI       │  │ • execute?() │  │ Summarize    │ │
│  │ Anthropic    │  └──────┬───────┘  │ HITL         │ │
│  │ Chrome AI*   │         │          │ Skills       │ │
│  │ (注册表扩展)  │  ┌──────┴───────┐  │ Memory       │ │
│  └──────────────┘  │ State (内存)  │  │ PatchToolCall│ │
│                    │ Filesystem   │  └──────────────┘ │
│  ┌─────────────┐   │ Composite    │                    │
│  │ToolDefinition│  │ IndexedDB*   │                    │
│  │              │  └──────────────┘                    │
│  │ • name       │                                      │
│  │ • parameters │   ┌─────────────────────────┐       │
│  │ • handler()  │   │      ReAct Loop          │       │
│  │ • prompt?    │   │  LLM ↔ ToolCall ↔ State  │       │
│  └──────────────┘   └─────────────────────────┘       │
└─────────────────────────────────────────────────────┘
                       * = 计划中
```

## 包依赖关系

```
schemas ← adapters ← backends ← tools ← middleware ← core
   ↑         ↑          ↑         ↑         ↑          ↑
   └─────────┴──────────┴─────────┴─────────┴──────────┘
                     zod (唯一运行时依赖)
```

| 包 | 运行时依赖 | 大小 (ESM) | 职责 |
|---|---|---|---|
| `schemas` | zod | 2.96 KB | 类型定义 + zodToJsonSchema |
| `adapters` | schemas + 可选 LLM SDK | 13.44 KB | LLM 统一接口 + provider 注册表 |
| `backends` | schemas + minimatch | 14.91 KB | 数据持久化协议 + 实现 |
| `tools` | schemas + adapters + backends + zod | 9.17 KB | 9 个内置工具 |
| `middleware` | schemas + adapters + backends | 9.67 KB | 5 个中间件 |
| `core` | 全部 | 9.94 KB | ReAct 循环引擎 |

## 核心接口

### LLMAdapter

```typescript
interface LLMAdapter {
  chat(params: ChatParams): Promise<ChatResponse>;   // 完整请求
  stream?(params: ChatParams): AsyncIterable<ChatChunk>; // 流式响应
  countTokens?(messages: Message[]): Promise<number>; // token 计数
  modelId: string;
  maxInputTokens?: number;
}
```

扩展方式：`registerAdapter('provider', factory)` — 无需修改核心代码。

### BackendProtocol

```typescript
interface BackendProtocol {
  lsInfo(path: string): Promise<FileInfo[]>;
  read(filePath: string, offset?, limit?): Promise<string>;
  write(filePath: string, content: string): Promise<WriteResult>;
  edit(filePath: string, old: string, new_: string, replaceAll?): Promise<EditResult>;
  grepRaw(pattern: string, path?, glob?): Promise<GrepMatch[] | string>;
  globInfo(pattern: string, path?): Promise<FileInfo[]>;
  execute?(command: string, cwd?): Promise<ExecuteResult>; // 可选
}
```

所有方法返回 `Promise` — 天然适配浏览器异步 API (IndexedDB, Fetch)。

### Middleware

```typescript
interface Middleware {
  name: string;
  beforeAgent?(state, runtime): Promise<Partial<AgentState> | void>;
  afterAgent?(state, runtime): Promise<Partial<AgentState> | void>;
  wrapToolCall?(request, handler): Promise<ToolCallResult>;
}
```

三个拦截点覆盖 Agent 生命周期的所有阶段。

### ToolDefinition

```typescript
interface ToolDefinition {
  name: string;
  description: string;
  parameters: z.ZodType;          // Zod schema
  handler: (args, context) => Promise<unknown>;
  prompt?: string;                // 注入到 system prompt
}
```

与 WebMCP `ModelContextTool` 的映射关系：
- `name` → `ModelContextTool.name`
- `description` → `ModelContextTool.description`
- `zodToJsonSchema(parameters)` → `ModelContextTool.inputSchema`
- `handler` → `ModelContextTool.execute`

## 适配器注册表

```typescript
// 内置: openai, anthropic
// 用户扩展:
registerAdapter('chrome', async (opts) => new ChromeAIAdapter(opts));
registerAdapter('ollama', async (opts) => new OllamaAdapter(opts));

// 使用:
createDeepAgent({ model: 'chrome:gemini-nano' });
```
