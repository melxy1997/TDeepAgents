import type { LLMAdapter } from './types.js';
import { OpenAIAdapter } from './openai.js';
import { AnthropicAdapter } from './anthropic.js';

/**
 * Factory to create an LLM adapter from a model string.
 *
 * Format: "provider:model-name"
 * - "openai:gpt-4o" → OpenAIAdapter
 * - "anthropic:claude-sonnet-4-6" → AnthropicAdapter
 *
 * If no provider prefix, defaults to OpenAI.
 */
export async function initAdapter(
  model: string,
  options?: { apiKey?: string; maxInputTokens?: number },
): Promise<LLMAdapter> {
  const [provider, ...modelParts] = model.includes(':') ? model.split(':') : ['openai', model];
  const modelId = modelParts.join(':') || model;

  switch (provider.toLowerCase()) {
    case 'openai':
      return OpenAIAdapter.create({ modelId, ...options });
    case 'anthropic':
      return AnthropicAdapter.create({ modelId, ...options });
    default:
      throw new Error(
        `Unknown LLM provider: "${provider}". Supported providers: openai, anthropic`,
      );
  }
}
