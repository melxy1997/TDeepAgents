import type { AgentState } from '@tdeepagents/adapters';
import type { Message, ToolCall } from '@tdeepagents/schemas';

/**
 * Middleware interface — intercepts before/after the agent's LLM call.
 * Modeled after the official DeepAgents middleware system.
 */
export interface Middleware {
  name: string;

  /** Runs before each LLM call. Can modify state (messages, system prompt, etc.) */
  beforeAgent?(state: AgentState, runtime: Runtime): Promise<Partial<AgentState> | void>;

  /** Runs after each LLM call. Can modify state (post-processing). */
  afterAgent?(state: AgentState, runtime: Runtime): Promise<Partial<AgentState> | void>;

  /** Wraps individual tool calls (cross-cutting concerns like logging, HITL). */
  wrapToolCall?(
    request: ToolCallRequest,
    handler: ToolHandler,
  ): Promise<ToolCallResult>;
}

export interface Runtime {
  adapter: unknown; // LLMAdapter
  backend: unknown; // BackendProtocol
  config: Record<string, unknown>;
  state: AgentState;
}

export interface ToolCallRequest {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export type ToolHandler = (request: ToolCallRequest) => Promise<ToolCallResult>;

export interface ToolCallResult {
  toolCallId: string;
  result: unknown;
}
