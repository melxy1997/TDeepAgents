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

## Agent Skills

### 规范兼容

完整支持 [Agent Skills Specification](https://agentskills.io/specification)：

| 官方特性 | 支持 | 说明 |
|---------|------|------|
| SKILL.md frontmatter (name, description) | ✅ | 核心字段 |
| license, compatibility, metadata, allowed-tools | ✅ | 扩展字段 |
| Progressive disclosure (3 层加载) | ✅ | metadata → instructions → resources |
| Resource 目录 (scripts/, references/, assets/) | ✅ | 自动发现并注入 metadata |
| 顶层脚本文件 (如 `arxiv_search.ts`) | ✅ | 与 scripts/ 同等发现 |
| Source precedence (后来者覆盖) | ✅ | 多路径按顺序，同名取最后 |
| 子 Agent 技能继承 | ✅ | GP subagent 继承，custom subagent 可覆盖 |

### 3 种技能来源

```typescript
// 1️⃣ 目录模式 — 传统 SKILL.md + scripts/ (需要 FilesystemBackend)
createDeepAgent({
  model: 'openai:gpt-4o',
  backend: new FilesystemBackend({ rootDir: '.' }),
  skills: ['./skills/', '~/.agents/skills/'],
});

// 2️⃣ SkillBundle JSON — 浏览器/端侧（无需文件系统）
const arxivBundle: SkillBundle = {
  metadata: {
    name: 'arxiv-search',
    description: 'Search arXiv for papers',
    path: '/skills/arxiv-search/SKILL.md',
  },
  instructions: '# arXiv Search\n\nUse this skill to search...',
  files: {
    'arxiv_search.ts': '// inline script content...',
  },
};

createDeepAgent({
  model: 'chrome:gemini-nano',
  backend: new StateBackend(),
  skillBundles: [arxivBundle],
});

// 3️⃣ URL 安装 — 从远程获取技能文件
import { installSkillFromUrl } from '@tdeepagents/middleware';

await installSkillFromUrl(
  'https://raw.githubusercontent.com/langchain-ai/deepagentsjs/main/examples/skills/arxiv-search/',
  ['SKILL.md', 'arxiv_search.ts'],
  backend,
);
```

### 端侧脚本执行

Node.js 下，Agent 通过 `execute` 工具运行脚本：
```bash
npx tsx /skills/arxiv-search/arxiv_search.ts "deep learning" --max-papers 5
```

浏览器端没有 shell，**两种替代方案**：

| 方案 | 适用场景 | 说明 |
|------|---------|------|
| **Fetch-based** | 脚本核心逻辑是 HTTP 调用 | Agent 直接用 `fetch` 调用 API (如 arxiv 的 `export.arxiv.org`) |
| **JS eval (JS skills)** | 纯计算/数据处理脚本 | SkillBundle 中的 `.js` 内容通过安全沙箱执行 |

实际上，arxiv-search 这类技能的脚本核心就是 `fetch()` 调用 — 在浏览器中**天然可用**。
Agent 读取 SKILL.md 说明后，会自行理解并实现逻辑（而非执行脚本）。

### 技能导出 (Node → Browser)

```typescript
import { createSkillBundle } from '@tdeepagents/middleware';

// 从 FilesystemBackend 导出为 SkillBundle JSON
const bundle = await createSkillBundle('/skills/arxiv-search/', fsBackend);
const json = JSON.stringify(bundle);
// 存入 IndexedDB 或分发为 URL
```

