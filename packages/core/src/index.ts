// ─── @tdeepagents/core ────────────────────────────────────────────────
// The main entry point for TDeepAgents framework.

export { createDeepAgent, DeepAgent } from './agent.js';
export type { DeepAgentOptions, AgentInput, AgentResult } from './agent.js';
export type { Runtime } from './runtime.js';
export { buildSystemPrompt } from './prompt-builder.js';

// Re-export key types from other packages for convenience
export type { LLMAdapter, ToolDefinition, ToolContext, AgentState } from '@tdeepagents/adapters';
export type { BackendProtocol } from '@tdeepagents/backends';
export type { Middleware } from '@tdeepagents/middleware';
export type { Message, StepEvent, SubAgentDef, TodoItem } from '@tdeepagents/schemas';

// Re-export backends and adapter factory for ease of use
export { StateBackend, FilesystemBackend, CompositeBackend } from '@tdeepagents/backends';
export { initAdapter, registerAdapter, getRegisteredAdapters, OpenAIAdapter, AnthropicAdapter } from '@tdeepagents/adapters';
export type { AdapterFactory } from '@tdeepagents/adapters';
export { zodToJsonSchema } from '@tdeepagents/schemas';
