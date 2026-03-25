# 可扩展性分析

## 扩展模式："新增文件"而非"修改核心"

| 扩展场景 | 改动范围 | 需改核心？ |
|---------|---------|----------|
| 新增 LLM 适配器 | 1 个新文件 + `registerAdapter()` | ❌ |
| 新增 Backend | 1 个新文件 | ❌ |
| 新增 Middleware | 1 个新文件 | ❌ |
| 新增内置 Tool | 1 个新文件 + barrel | ❌ |
| 支持浏览器运行 | 使用 `./browser` 入口 | ❌ |
| 支持 WebMCP | 新包/新 middleware | ❌ |

## 浏览器运行时

### 入口拆分

```typescript
// Node.js (包含 FilesystemBackend)
import { StateBackend, FilesystemBackend } from '@tdeepagents/backends';

// Browser (排除 node:fs 依赖)
import { StateBackend, CompositeBackend } from '@tdeepagents/backends/browser';
```

### StateBackend 已可直接用于浏览器

`StateBackend` 是纯内存 `Map`，零 Node.js 依赖。浏览器端可以直接使用：

```typescript
const agent = createDeepAgent({
  model: 'chrome:gemini-nano',
  backend: new StateBackend({ '/readme.md': { content: '# Hello' } }),
});
```

### 持久化扩展

只需实现 `BackendProtocol`：

```typescript
class IndexedDBBackend implements BackendProtocol {
  async read(path) { return (await db.get('files', path))?.content; }
  async write(path, content) { await db.put('files', { path, content }); }
  // ... 其他方法
}
```

## Chrome Built-in AI

### 技术方案

Chrome Prompt API 不支持 function calling，但支持 **结构化输出**（`responseConstraint`）。
利用这一特性实现 prompt-based tool calling：

```typescript
class ChromeAIAdapter implements LLMAdapter {
  modelId = 'chrome:gemini-nano';

  async chat(params: ChatParams): Promise<ChatResponse> {
    const session = await ai.languageModel.create({
      systemPrompt: this.extractSystemPrompt(params.messages),
    });

    if (params.tools?.length) {
      // 通过结构化输出约束工具调用格式
      const toolCallSchema = {
        type: 'object',
        properties: {
          tool_calls: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', enum: params.tools.map(t => t.name) },
                arguments: { type: 'object' },
              },
              required: ['name', 'arguments'],
            },
          },
          text: { type: 'string' },
        },
      };

      const prompt = this.buildToolPrompt(params);
      const result = await session.prompt(prompt, {
        responseConstraint: toolCallSchema,  // Chrome AI 结构化输出
      });

      session.destroy();
      return this.parseToolCallResponse(JSON.parse(result));
    }

    const result = await session.prompt(userContent);
    session.destroy();
    return { message: { role: 'assistant', content: result }, ... };
  }
}
```

### 关键优势

- **完全端侧推理** — 零网络延迟，数据不出设备
- **JSON Schema 保证** — `responseConstraint` 确保输出结构可靠
- **与 `zodToJsonSchema` 无缝衔接** — Zod → JSON Schema → `responseConstraint`

## WebMCP

### 规范映射

WebMCP 通过 `navigator.modelContext.registerTool()` 暴露网页工具：

```typescript
// WebMCP API (W3C 标准草案)
navigator.modelContext.registerTool({
  name: 'search_products',
  description: 'Search products by keyword',
  inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
  execute: async (input) => { /* ... */ },
});
```

TDeepAgents 的 `ToolDefinition` 与之天然对齐：

| TDeepAgents | WebMCP |
|---|---|
| `name` | `name` |
| `description` | `description` |
| `zodToJsonSchema(parameters)` | `inputSchema` |
| `handler(args, ctx)` | `execute(input, client)` |

### 集成方向

**方向 A：Agent 消费 WebMCP 工具**（Agent 调用网页暴露的工具）

```typescript
// 从页面读取 WebMCP 工具并转为 ToolDefinition
function webMCPToolToToolDef(tool: ModelContextTool): ToolDefinition {
  return {
    name: tool.name,
    description: tool.description,
    parameters: jsonSchemaToZod(tool.inputSchema),
    handler: async (args) => tool.execute(args),
  };
}
```

**方向 B：网页暴露 Agent 工具为 WebMCP**（让外部 Agent/浏览器助手调用我们的工具）

```typescript
// 将 TDeepAgents 工具注册为 WebMCP 工具
for (const tool of agent.resolveTools()) {
  navigator.modelContext.registerTool({
    name: tool.name,
    description: tool.description,
    inputSchema: zodToJsonSchema(tool.parameters),
    execute: async (input) => tool.handler(input, context),
  });
}
```
