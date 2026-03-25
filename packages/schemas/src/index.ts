// ─── @tdeepagents/schemas ─────────────────────────────────────────────
// All data structures defined once with Zod. Types auto-inferred.

export {
  MessageSchema,
  ToolCallSchema,
  ToolResultSchema,
  type Message,
  type ToolCall,
  type ToolResult,
} from './message.js';

export {
  TodoItemSchema,
  TodoListSchema,
  TodoStatusSchema,
  type TodoItem,
  type TodoList,
  type TodoStatus,
} from './todo.js';

export {
  AgentConfigSchema,
  SubAgentDefSchema,
  type AgentConfig,
  type SubAgentDef,
} from './agent-config.js';

export {
  FileInfoSchema,
  GrepMatchSchema,
  WriteResultSchema,
  EditResultSchema,
  ExecuteResultSchema,
  type FileInfo,
  type GrepMatch,
  type WriteResult,
  type EditResult,
  type ExecuteResult,
} from './backend.js';

export {
  StepEventSchema,
  StepTypeSchema,
  type StepEvent,
  type StepType,
} from './event.js';

export {
  SkillMetadataSchema,
  type SkillMetadata,
} from './skill.js';
