import type { z } from 'zod';
import type { Message } from '@tdeepagents/schemas';

// ─── Tool Definition (used across the framework) ─────────────────────

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: z.ZodType;
  handler: (args: unknown, context: ToolContext) => Promise<unknown>;
  /** Additional system prompt instructions for this tool */
  prompt?: string;
}

export interface ToolContext {
  backend: unknown; // BackendProtocol — resolved at runtime
  agentState: AgentState;
  config: Record<string, unknown>;
}

export interface AgentState {
  messages: Message[];
  todos: unknown[];
  files: Record<string, unknown>;
  [key: string]: unknown;
}

// ─── LLM Adapter Interface ───────────────────────────────────────────

export interface ChatParams {
  messages: Message[];
  tools?: ToolDefinition[];
  responseFormat?: z.ZodType;
  temperature?: number;
  maxTokens?: number;
}

export interface ChatResponse {
  message: Message;
  usage: { inputTokens: number; outputTokens: number };
  finishReason: 'stop' | 'tool_calls' | 'length';
}

export interface ChatChunk {
  type: 'text_delta' | 'tool_call_delta' | 'done';
  textDelta?: string;
  toolCallDelta?: {
    id?: string;
    name?: string;
    argumentsDelta?: string;
  };
  /** Provided only on 'done' chunk */
  usage?: { inputTokens: number; outputTokens: number };
}

export interface LLMAdapter {
  /** Send a complete chat request, receive a full response */
  chat(params: ChatParams): Promise<ChatResponse>;
  /** Stream a chat response as chunks (optional) */
  stream?(params: ChatParams): AsyncIterable<ChatChunk>;
  /** Estimate token count for a set of messages (optional) */
  countTokens?(messages: Message[]): Promise<number>;
  /** The model identifier string (e.g. 'gpt-4o', 'claude-sonnet-4-6') */
  modelId: string;
  /** Maximum input context window in tokens (used for summarization triggers) */
  maxInputTokens?: number;
}
