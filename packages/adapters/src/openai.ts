import type { Message } from '@tdeepagents/schemas';
import type { ChatChunk, ChatParams, ChatResponse, LLMAdapter, ToolDefinition } from './types.js';

/**
 * OpenAI adapter — wraps the `openai` npm package to conform to LLMAdapter.
 * Converts tool definitions to OpenAI function calling format.
 */
export class OpenAIAdapter implements LLMAdapter {
  public readonly modelId: string;
  public readonly maxInputTokens?: number;
  private client: any; // OpenAI client instance

  constructor(options: { modelId?: string; apiKey?: string; maxInputTokens?: number }) {
    this.modelId = options.modelId ?? 'gpt-4o';
    this.maxInputTokens = options.maxInputTokens;

    // Dynamically import to avoid hard dependency
    try {
      // biome-ignore lint/suspicious/noExplicitAny: dynamic import
      const OpenAI = (globalThis as any).__openai_module__;
      if (!OpenAI) {
        throw new Error('openai package not loaded');
      }
      this.client = new OpenAI({ apiKey: options.apiKey });
    } catch {
      throw new Error(
        'OpenAI adapter requires the "openai" package. Install it: npm install openai',
      );
    }
  }

  /**
   * Static factory that does the dynamic import properly.
   */
  static async create(options: {
    modelId?: string;
    apiKey?: string;
    maxInputTokens?: number;
  }): Promise<OpenAIAdapter> {
    const openaiModule = await import('openai');
    const client = new openaiModule.default({ apiKey: options.apiKey });
    const adapter = new OpenAIAdapter({ ...options });
    adapter.client = client;
    return adapter;
  }

  async chat(params: ChatParams): Promise<ChatResponse> {
    const openaiMessages = this.convertMessages(params.messages);
    const tools = params.tools ? this.convertTools(params.tools) : undefined;

    const response = await this.client.chat.completions.create({
      model: this.modelId,
      messages: openaiMessages,
      tools: tools?.length ? tools : undefined,
      temperature: params.temperature,
      max_tokens: params.maxTokens,
    });

    const choice = response.choices[0];
    const message = this.convertResponseMessage(choice.message);

    return {
      message,
      usage: {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
      },
      finishReason:
        choice.finish_reason === 'tool_calls'
          ? 'tool_calls'
          : choice.finish_reason === 'length'
            ? 'length'
            : 'stop',
    };
  }

  async *stream(params: ChatParams): AsyncIterable<ChatChunk> {
    const openaiMessages = this.convertMessages(params.messages);
    const tools = params.tools ? this.convertTools(params.tools) : undefined;

    const stream = await this.client.chat.completions.create({
      model: this.modelId,
      messages: openaiMessages,
      tools: tools?.length ? tools : undefined,
      temperature: params.temperature,
      max_tokens: params.maxTokens,
      stream: true,
      stream_options: { include_usage: true },
    });

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta;

      if (delta?.content) {
        yield { type: 'text_delta', textDelta: delta.content };
      }

      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          yield {
            type: 'tool_call_delta',
            toolCallDelta: {
              id: tc.id,
              name: tc.function?.name,
              argumentsDelta: tc.function?.arguments,
            },
          };
        }
      }

      if (chunk.usage) {
        yield {
          type: 'done',
          usage: {
            inputTokens: chunk.usage.prompt_tokens ?? 0,
            outputTokens: chunk.usage.completion_tokens ?? 0,
          },
        };
      }
    }
  }

  // ─── Converters ───────────────────────────────────────────────────

  private convertMessages(messages: Message[]): any[] {
    return messages.map((msg) => {
      if (msg.role === 'tool' && msg.toolResults?.length) {
        // Tool result messages in OpenAI format
        return {
          role: 'tool',
          tool_call_id: msg.toolResults[0].toolCallId,
          content: typeof msg.toolResults[0].result === 'string'
            ? msg.toolResults[0].result
            : JSON.stringify(msg.toolResults[0].result),
        };
      }

      const result: any = {
        role: msg.role,
        content: msg.content ?? '',
      };

      if (msg.toolCalls?.length) {
        result.tool_calls = msg.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments),
          },
        }));
        // OpenAI requires content to be null when tool_calls are present
        if (!msg.content) result.content = null;
      }

      return result;
    });
  }

  private convertTools(tools: ToolDefinition[]): any[] {
    return tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: this.zodToJsonSchema(tool.parameters),
      },
    }));
  }

  private convertResponseMessage(msg: any): Message {
    const result: Message = {
      role: 'assistant',
      content: msg.content ?? undefined,
    };

    if (msg.tool_calls?.length) {
      result.toolCalls = msg.tool_calls.map((tc: any) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments || '{}'),
      }));
    }

    return result;
  }

  /**
   * Minimal Zod-to-JSON-Schema converter. Handles common Zod types.
   * For production use, consider `zod-to-json-schema` package.
   */
  private zodToJsonSchema(schema: any): any {
    if (!schema || !schema._def) {
      return { type: 'object', properties: {} };
    }

    const def = schema._def;

    switch (def.typeName) {
      case 'ZodObject': {
        const properties: Record<string, any> = {};
        const required: string[] = [];
        const shape = schema.shape;
        for (const [key, value] of Object.entries(shape)) {
          properties[key] = this.zodToJsonSchema(value);
          // Check if field is required (not optional)
          if ((value as any)?._def?.typeName !== 'ZodOptional') {
            required.push(key);
          }
        }
        return {
          type: 'object',
          properties,
          ...(required.length ? { required } : {}),
        };
      }
      case 'ZodString':
        return { type: 'string', ...(def.description ? { description: def.description } : {}) };
      case 'ZodNumber':
        return { type: 'number', ...(def.description ? { description: def.description } : {}) };
      case 'ZodBoolean':
        return { type: 'boolean', ...(def.description ? { description: def.description } : {}) };
      case 'ZodArray':
        return { type: 'array', items: this.zodToJsonSchema(def.type) };
      case 'ZodEnum':
        return { type: 'string', enum: def.values };
      case 'ZodOptional':
        return this.zodToJsonSchema(def.innerType);
      case 'ZodDefault':
        return { ...this.zodToJsonSchema(def.innerType), default: def.defaultValue() };
      case 'ZodRecord':
        return { type: 'object', additionalProperties: this.zodToJsonSchema(def.valueType) };
      default:
        return { type: 'string' };
    }
  }
}
