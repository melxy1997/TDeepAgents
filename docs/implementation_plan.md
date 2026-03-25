# TDeepAgents — TypeScript-native Deep Agent Framework

A zero-LangChain-dependency TypeScript library that replicates the full capabilities of [LangChain DeepAgents](https://docs.langchain.com/oss/python/deepagents/overview): planning, filesystem, subagent delegation, context management, human-in-the-loop, skills, memory, and structured output — built on **Zod** for type safety.

## User Review Required

> [!IMPORTANT]
> **LLM Adapter Strategy**: The plan uses a thin adapter interface that wraps any LLM SDK (OpenAI, Anthropic, Google, Ollama). The initial implementation will include **OpenAI** and **Anthropic** adapters. Should we also include Ollama or Google from the start?

> [!IMPORTANT]
> **Package Naming**: The plan uses `@tdeepagents/*` as the npm scope. Confirm this is the desired scope, or if you prefer `tdeepagents` (no scope) or another name.

> [!WARNING]
> **Sandbox/Docker Support**: The official DeepAgents supports Docker & remote sandbox backends. This plan includes a `DockerBackend` design but will **defer its implementation** to a later phase, focusing first on `StateBackend` (in-memory) and `FilesystemBackend` (local disk). Is this acceptable?

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      @tdeepagents/core                      │
│   createDeepAgent() → ReAct loop, orchestration, events     │
├──────────┬──────────┬──────────┬──────────┬─────────────────┤
│ schemas  │ adapters │ backends │  tools   │   middleware     │
│ (Zod)    │ (LLM)   │ (FS)    │ (built-in)│  (pipeline)     │
└──────────┴──────────┴──────────┴──────────┴─────────────────┘
```

### Monorepo Structure

```
TDeepAgents/
├── packages/
│   ├── schemas/          # Zod schema definitions (shared type contract)
│   ├── adapters/         # LLM provider adapters (OpenAI, Anthropic, ...)
│   ├── backends/         # Backend protocol + implementations
│   ├── tools/            # Built-in tool definitions
│   ├── middleware/        # Middleware pipeline
│   └── core/             # Agent engine, createDeepAgent()
├── examples/
│   └── basic-agent/      # Simple working example
├── package.json          # pnpm workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── biome.json
└── vitest.workspace.ts
```

---

## Proposed Changes

### Monorepo Scaffold

Set up the workspace root with pnpm, shared TypeScript config, Biome linting, and Vitest.

#### [NEW] [package.json](file:///Users/xyliu3/Desktop/work/empty/TDeepAgents/package.json)
Workspace root with `"workspaces"` pointing to `packages/*`.

#### [NEW] [pnpm-workspace.yaml](file:///Users/xyliu3/Desktop/work/empty/TDeepAgents/pnpm-workspace.yaml)
Lists `packages/*` and `examples/*`.

#### [NEW] [tsconfig.base.json](file:///Users/xyliu3/Desktop/work/empty/TDeepAgents/tsconfig.base.json)
Shared TS config: ES2022 target, strict mode, path aliases.

#### [NEW] [biome.json](file:///Users/xyliu3/Desktop/work/empty/TDeepAgents/biome.json)
Linter + formatter config (replaces ESLint + Prettier).

#### [NEW] [vitest.workspace.ts](file:///Users/xyliu3/Desktop/work/empty/TDeepAgents/vitest.workspace.ts)
Workspace-level Vitest configuration.

---

### `@tdeepagents/schemas` — Type Contract Layer

All data structures defined once with Zod; TypeScript types auto-inferred. Every other package depends on this.

#### [NEW] [packages/schemas/src/index.ts](file:///Users/xyliu3/Desktop/work/empty/TDeepAgents/packages/schemas/src/index.ts)
Re-exports all schemas.

#### [NEW] [packages/schemas/src/message.ts](file:///Users/xyliu3/Desktop/work/empty/TDeepAgents/packages/schemas/src/message.ts)
- `MessageSchema` — role (`user` | `assistant` | `system` | `tool`), content, optional `toolCalls[]`, optional `toolResults[]`
- `ToolCallSchema` — id, name, arguments
- `ToolResultSchema` — toolCallId, result

#### [NEW] [packages/schemas/src/todo.ts](file:///Users/xyliu3/Desktop/work/empty/TDeepAgents/packages/schemas/src/todo.ts)
- `TodoItemSchema` — id, task, status (`pending` | `in_progress` | `completed`), notes
- `TodoListSchema` — array of TodoItem

#### [NEW] [packages/schemas/src/agent-config.ts](file:///Users/xyliu3/Desktop/work/empty/TDeepAgents/packages/schemas/src/agent-config.ts)
- `AgentConfigSchema` — name, model, systemPrompt, maxIterations, backend type, etc.
- `SubAgentDefSchema` — name, description, systemPrompt, tools, model override

#### [NEW] [packages/schemas/src/backend.ts](file:///Users/xyliu3/Desktop/work/empty/TDeepAgents/packages/schemas/src/backend.ts)
- `FileInfoSchema` — path, isDir, size, modifiedAt
- `GrepMatchSchema` — path, line, text
- `WriteResultSchema` — error, path, filesUpdate
- `EditResultSchema` — error, path, filesUpdate, occurrences

#### [NEW] [packages/schemas/src/event.ts](file:///Users/xyliu3/Desktop/work/empty/TDeepAgents/packages/schemas/src/event.ts)
- `StepEventSchema` — step type (`llm_call` | `tool_call` | `tool_result` | `summary` | `error`), data, timestamp

#### [NEW] [packages/schemas/src/skill.ts](file:///Users/xyliu3/Desktop/work/empty/TDeepAgents/packages/schemas/src/skill.ts)
- `SkillMetadataSchema` — name, description, path

---

### `@tdeepagents/adapters` — LLM Adapter Layer

Thin adapter interface that wraps any LLM provider. Each adapter converts to/from the common `Message` schema.

#### [NEW] [packages/adapters/src/types.ts](file:///Users/xyliu3/Desktop/work/empty/TDeepAgents/packages/adapters/src/types.ts)
```typescript
interface LLMAdapter {
  chat(params: ChatParams): Promise<ChatResponse>;
  stream?(params: ChatParams): AsyncIterable<ChatChunk>;
  countTokens?(messages: Message[]): Promise<number>;
  modelId: string;
  maxInputTokens?: number;
}

interface ChatParams {
  messages: Message[];
  tools?: ToolDefinition[];
  responseFormat?: ZodSchema;
  temperature?: number;
  maxTokens?: number;
}

interface ChatResponse {
  message: Message;
  usage: { inputTokens: number; outputTokens: number };
  finishReason: 'stop' | 'tool_calls' | 'length';
}
```

#### [NEW] [packages/adapters/src/openai.ts](file:///Users/xyliu3/Desktop/work/empty/TDeepAgents/packages/adapters/src/openai.ts)
OpenAI adapter using the `openai` npm package. Converts tool definitions to OpenAI function calling format.

#### [NEW] [packages/adapters/src/anthropic.ts](file:///Users/xyliu3/Desktop/work/empty/TDeepAgents/packages/adapters/src/anthropic.ts)
Anthropic adapter using `@anthropic-ai/sdk`. Converts tool definitions to Anthropic tool_use format.

#### [NEW] [packages/adapters/src/init-adapter.ts](file:///Users/xyliu3/Desktop/work/empty/TDeepAgents/packages/adapters/src/init-adapter.ts)
Factory function: `initAdapter("openai:gpt-4o")` → returns the appropriate `LLMAdapter` instance.

---

### `@tdeepagents/backends` — Backend Protocol + Implementations

Mirrors the official `BackendProtocol` faithfully.

#### [NEW] [packages/backends/src/protocol.ts](file:///Users/xyliu3/Desktop/work/empty/TDeepAgents/packages/backends/src/protocol.ts)
```typescript
interface BackendProtocol {
  lsInfo(path: string): Promise<FileInfo[]>;
  read(filePath: string, offset?: number, limit?: number): Promise<string>;
  write(filePath: string, content: string): Promise<WriteResult>;
  edit(filePath: string, oldString: string, newString: string, replaceAll?: boolean): Promise<EditResult>;
  grepRaw(pattern: string, path?: string, glob?: string): Promise<GrepMatch[] | string>;
  globInfo(pattern: string, path?: string): Promise<FileInfo[]>;
  execute?(command: string, cwd?: string): Promise<ExecuteResult>;
}
```

#### [NEW] [packages/backends/src/state-backend.ts](file:///Users/xyliu3/Desktop/work/empty/TDeepAgents/packages/backends/src/state-backend.ts)
In-memory ephemeral backend. Files stored in a `Map<string, {content, metadata}>`. Default backend.

#### [NEW] [packages/backends/src/filesystem-backend.ts](file:///Users/xyliu3/Desktop/work/empty/TDeepAgents/packages/backends/src/filesystem-backend.ts)
Local disk backend with `rootDir` and `virtualMode` (path sandboxing). Uses Node.js `fs` APIs. Supports `execute` via `child_process`.

#### [NEW] [packages/backends/src/composite-backend.ts](file:///Users/xyliu3/Desktop/work/empty/TDeepAgents/packages/backends/src/composite-backend.ts)
Router backend: dispatches to different backends based on path prefix (e.g., `/memories/` → StoreBackend, default → StateBackend).

---

### `@tdeepagents/tools` — Built-in Tool Definitions

Each tool is a **Zod-defined schema + handler function** pair. Mirrors the official 9 built-in tools.

#### [NEW] [packages/tools/src/types.ts](file:///Users/xyliu3/Desktop/work/empty/TDeepAgents/packages/tools/src/types.ts)
```typescript
interface ToolDefinition {
  name: string;
  description: string;
  parameters: ZodSchema;
  handler: (args: unknown, context: ToolContext) => Promise<unknown>;
  prompt?: string; // additional system prompt instructions
}

interface ToolContext {
  backend: BackendProtocol;
  agentState: AgentState;
  config: Record<string, unknown>;
}
```

#### [NEW] [packages/tools/src/todo.ts](file:///Users/xyliu3/Desktop/work/empty/TDeepAgents/packages/tools/src/todo.ts)
`write_todos` — Write/update todo list with statuses (`pending` | `in_progress` | `completed`). Stored in agent state.

#### [NEW] [packages/tools/src/filesystem.ts](file:///Users/xyliu3/Desktop/work/empty/TDeepAgents/packages/tools/src/filesystem.ts)
`ls`, `read_file`, `write_file`, `edit_file`, `glob`, `grep` — all delegate to the `BackendProtocol`.

#### [NEW] [packages/tools/src/execute.ts](file:///Users/xyliu3/Desktop/work/empty/TDeepAgents/packages/tools/src/execute.ts)
`execute` — Shell command execution. Only available when backend implements `execute()`.

#### [NEW] [packages/tools/src/task.ts](file:///Users/xyliu3/Desktop/work/empty/TDeepAgents/packages/tools/src/task.ts)
`task` — Subagent delegation. Spawns a new agent instance with isolated context, runs to completion, returns final report.

---

### `@tdeepagents/middleware` — Middleware Pipeline

Middleware intercepts before/after the agent's LLM call. Modeled after the official middleware system.

#### [NEW] [packages/middleware/src/types.ts](file:///Users/xyliu3/Desktop/work/empty/TDeepAgents/packages/middleware/src/types.ts)
```typescript
interface Middleware {
  name: string;
  beforeAgent?(state: AgentState, runtime: Runtime): Promise<Partial<AgentState>>;
  afterAgent?(state: AgentState, runtime: Runtime): Promise<Partial<AgentState>>;
  wrapToolCall?(request: ToolCallRequest, handler: ToolHandler): Promise<ToolCallResult>;
}
```

#### [NEW] [packages/middleware/src/summarization.ts](file:///Users/xyliu3/Desktop/work/empty/TDeepAgents/packages/middleware/src/summarization.ts)
Context compression: offloads large tool results (>20k tokens) to files, triggers summarization at 85% of context window. Preserves full history to filesystem.

#### [NEW] [packages/middleware/src/hitl.ts](file:///Users/xyliu3/Desktop/work/empty/TDeepAgents/packages/middleware/src/hitl.ts)
Human-in-the-loop: pauses before specified tool calls, waits for approval/edit/reject via a callback.

#### [NEW] [packages/middleware/src/skills.ts](file:///Users/xyliu3/Desktop/work/empty/TDeepAgents/packages/middleware/src/skills.ts)
Skills loader: scans for `SKILL.md` files, reads frontmatter at startup, loads full content on-demand (progressive disclosure).

#### [NEW] [packages/middleware/src/memory.ts](file:///Users/xyliu3/Desktop/work/empty/TDeepAgents/packages/middleware/src/memory.ts)
Memory: loads `AGENTS.md` files into system prompt context. Agent can update memory files.

#### [NEW] [packages/middleware/src/patch-tool-calls.ts](file:///Users/xyliu3/Desktop/work/empty/TDeepAgents/packages/middleware/src/patch-tool-calls.ts)
Fixes message history when tool calls are interrupted (no matching tool result).

---

### `@tdeepagents/core` — Agent Engine

The heart of the library. Implements the ReAct loop and wires everything together.

#### [NEW] [packages/core/src/agent.ts](file:///Users/xyliu3/Desktop/work/empty/TDeepAgents/packages/core/src/agent.ts)

```typescript
interface DeepAgentOptions {
  model: string | LLMAdapter;
  tools?: ToolDefinition[];
  systemPrompt?: string;
  backend?: BackendProtocol | ((runtime: Runtime) => BackendProtocol);
  middleware?: Middleware[];
  subagents?: SubAgentDef[];
  interruptOn?: Record<string, boolean | { allowedDecisions: string[] }>;
  memory?: string[];
  skills?: string[];
  responseFormat?: ZodSchema;
  maxIterations?: number;
  onStep?: (event: StepEvent) => void | Promise<void>;
}

function createDeepAgent(options: DeepAgentOptions): DeepAgent;

class DeepAgent {
  invoke(input: { messages: Message[]; files?: Record<string, FileData> }): Promise<AgentResult>;
  stream(input: { messages: Message[]; files?: Record<string, FileData> }): AsyncIterable<StepEvent>;
}
```

**Core loop (ReAct pattern):**
1. Run `beforeAgent` middlewares
2. Build system prompt (base + tool prompts + memory + skills metadata)
3. Call LLM via adapter
4. If tool calls → execute tools (with middleware wrapping) → append results → loop
5. If no tool calls → agent is done
6. Run `afterAgent` middlewares
7. Check context compression triggers (offloading, summarization)
8. Return final message + state

#### [NEW] [packages/core/src/runtime.ts](file:///Users/xyliu3/Desktop/work/empty/TDeepAgents/packages/core/src/runtime.ts)
Runtime context object passed to middlewares and tools. Holds the current backend, adapter, config, and state.

#### [NEW] [packages/core/src/prompt-builder.ts](file:///Users/xyliu3/Desktop/work/empty/TDeepAgents/packages/core/src/prompt-builder.ts)
Assembles the complete system prompt from base prompt + tool descriptions + memory content + skills metadata.

---

### Example

#### [NEW] [examples/basic-agent/index.ts](file:///Users/xyliu3/Desktop/work/empty/TDeepAgents/examples/basic-agent/index.ts)

```typescript
import { createDeepAgent } from '@tdeepagents/core';

const agent = createDeepAgent({
  model: 'openai:gpt-4o',
  systemPrompt: 'You are a helpful research assistant.',
  tools: [/* custom tools */],
});

const result = await agent.invoke({
  messages: [{ role: 'user', content: 'Research TypeScript agent frameworks' }],
});
```

---

## Verification Plan

### Automated Tests

All tests use **Vitest** and run from the workspace root:

```bash
# Run all unit tests
pnpm vitest run

# Run tests for a specific package
pnpm vitest run --project schemas
pnpm vitest run --project core
```

**Test coverage per package:**

| Package | Tests |
|---------|-------|
| `schemas` | Zod schema validation: valid inputs parse, invalid inputs throw |
| `adapters` | Mock LLM responses, verify message format conversion |
| `backends` | StateBackend CRUD operations, FilesystemBackend with temp dirs, CompositeBackend routing |
| `tools` | Each tool handler with mocked backend, verify input/output |
| `middleware` | Summarization trigger logic, HITL callback flow, PatchToolCalls repair |
| `core` | Full ReAct loop with mocked adapter: single-turn, multi-tool, subagent delegation |

### Manual Verification

1. **Build check**: Run `pnpm build` in root — all packages should compile without errors
2. **Type check**: Run `pnpm typecheck` (tsc --noEmit) — zero errors
3. **Lint**: Run `pnpm lint` (biome check) — zero errors
4. **Example run**: Execute `examples/basic-agent/index.ts` with a real OpenAI API key and verify the agent can plan, use filesystem tools, and return a coherent response
