import type { LLMAdapter } from './types.js';

/**
 * Adapter factory function type.
 * Each provider registers a factory that creates an LLMAdapter from model options.
 */
export type AdapterFactory = (options: {
  modelId: string;
  apiKey?: string;
  maxInputTokens?: number;
}) => Promise<LLMAdapter>;

/**
 * Adapter registry — extensible map of provider → factory.
 * Built-in providers (openai, anthropic) are registered by default.
 * Users can register custom adapters (e.g., 'chrome', 'ollama') via `registerAdapter()`.
 */
const registry = new Map<string, AdapterFactory>();

/**
 * Register a custom adapter factory for a provider name.
 *
 * @example
 * ```ts
 * registerAdapter('chrome', async (opts) => new ChromeAIAdapter(opts));
 * const agent = createDeepAgent({ model: 'chrome:gemini-nano' });
 * ```
 */
export function registerAdapter(provider: string, factory: AdapterFactory): void {
  registry.set(provider.toLowerCase(), factory);
}

/**
 * Get all registered provider names.
 */
export function getRegisteredAdapters(): string[] {
  return [...registry.keys()];
}

/**
 * Factory to create an LLM adapter from a model string.
 *
 * Format: "provider:model-name"
 * - "openai:gpt-4o" → OpenAIAdapter
 * - "anthropic:claude-sonnet-4-6" → AnthropicAdapter
 *
 * If no provider prefix, defaults to OpenAI.
 * Users can register custom providers via `registerAdapter()`.
 */
export async function initAdapter(
  model: string,
  options?: { apiKey?: string; maxInputTokens?: number },
): Promise<LLMAdapter> {
  const [provider, ...modelParts] = model.includes(':') ? model.split(':') : ['openai', model];
  const modelId = modelParts.join(':') || model;
  const providerKey = provider.toLowerCase();

  const factory = registry.get(providerKey);
  if (!factory) {
    const available = getRegisteredAdapters().join(', ') || 'none';
    throw new Error(
      `Unknown LLM provider: "${provider}". Registered providers: ${available}. ` +
      `Use registerAdapter() to add custom providers.`,
    );
  }

  return factory({ modelId, ...options });
}

// ─── Register built-in adapters ──────────────────────────────────────

registerAdapter('openai', async (opts) => {
  const { OpenAIAdapter } = await import('./openai.js');
  return OpenAIAdapter.create(opts);
});

registerAdapter('anthropic', async (opts) => {
  const { AnthropicAdapter } = await import('./anthropic.js');
  return AnthropicAdapter.create(opts);
});
