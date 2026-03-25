import type { LLMAdapter, AgentState } from '@tdeepagents/adapters';
import type { BackendProtocol } from '@tdeepagents/backends';
import type { Middleware } from '@tdeepagents/middleware';

/**
 * Runtime — the context object passed to middlewares and tools.
 * Holds references to the current adapter, backend, config, and state.
 */
export interface Runtime {
  adapter: LLMAdapter;
  backend: BackendProtocol;
  config: Record<string, unknown>;
  state: AgentState;
}

export function createRuntime(
  adapter: LLMAdapter,
  backend: BackendProtocol,
  state: AgentState,
  config: Record<string, unknown> = {},
): Runtime {
  return { adapter, backend, config, state };
}
