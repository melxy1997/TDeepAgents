import type { Message } from '@tdeepagents/schemas';
import type { ChatChunk, ChatParams, ChatResponse, LLMAdapter, ToolDefinition } from './types.js';

/**
 * Anthropic adapter — wraps `@anthropic-ai/sdk` to conform to LLMAdapter.
 * Converts tool definitions to Anthropic tool_use format.
 */
export class AnthropicAdapter implements LLMAdapter {
  public readonly modelId: string;
  public readonly maxInputTokens?: number;
  private client: any;

  constructor(options: { modelId?: string; apiKey?: string; maxInputTokens?: number }) {
    this.modelId = options.modelId ?? 'claude-sonnet-4-20250514';
    this.maxInputTokens = options.maxInputTokens;
  }

  static async create(options: {
    modelId?: string;
    apiKey?: string;
    maxInputTokens?: number;
  }): Promise<AnthropicAdapter> {
    const anthropicModule = await import('@anthropic-ai/sdk');
    const adapter = new AnthropicAdapter(options);
    adapter.client = new anthropicModule.default({ apiKey: options.apiKey });
    return adapter;
  }

  async chat(params: ChatParams): Promise<ChatResponse> {
    const { system, messages } = this.convertMessages(params.messages);
    const tools = params.tools ? this.convertTools(params.tools) : undefined;

    const response = await this.client.messages.create({
      model: this.modelId,
      max_tokens: params.maxTokens ?? 4096,
      system: system || undefined,
      messages,
      tools: tools?.length ? tools : undefined,
      temperature: params.temperature,
    });

    const message = this.convertResponseMessage(response);
    const hasToolUse = response.content.some((block: any) => block.type === 'tool_use');

    return {
      message,
      usage: {
        inputTokens: response.usage?.input_tokens ?? 0,
        outputTokens: response.usage?.output_tokens ?? 0,
      },
      finishReason: hasToolUse
        ? 'tool_calls'
        : response.stop_reason === 'max_tokens'
          ? 'length'
          : 'stop',
    };
  }

  async *stream(params: ChatParams): AsyncIterable<ChatChunk> {
    const { system, messages } = this.convertMessages(params.messages);
    const tools = params.tools ? this.convertTools(params.tools) : undefined;

    const stream = this.client.messages.stream({
      model: this.modelId,
      max_tokens: params.maxTokens ?? 4096,
      system: system || undefined,
      messages,
      tools: tools?.length ? tools : undefined,
      temperature: params.temperature,
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta') {
        if (event.delta.type === 'text_delta') {
          yield { type: 'text_delta', textDelta: event.delta.text };
        } else if (event.delta.type === 'input_json_delta') {
          yield {
            type: 'tool_call_delta',
            toolCallDelta: { argumentsDelta: event.delta.partial_json },
          };
        }
      } else if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
        yield {
          type: 'tool_call_delta',
          toolCallDelta: {
            id: event.content_block.id,
            name: event.content_block.name,
          },
        };
      } else if (event.type === 'message_delta') {
        yield {
          type: 'done',
          usage: {
            inputTokens: 0,
            outputTokens: event.usage?.output_tokens ?? 0,
          },
        };
      }
    }
  }

  async countTokens(messages: Message[]): Promise<number> {
    if (this.client.messages?.countTokens) {
      const { system, messages: converted } = this.convertMessages(messages);
      const result = await this.client.messages.countTokens({
        model: this.modelId,
        system: system || undefined,
        messages: converted,
      });
      return result.input_tokens;
    }
    // Rough estimate: ~4 chars per token
    const totalChars = messages.reduce((acc, m) => acc + (m.content?.length ?? 0), 0);
    return Math.ceil(totalChars / 4);
  }

  // ─── Converters ───────────────────────────────────────────────────

  private convertMessages(messages: Message[]): { system: string; messages: any[] } {
    let system = '';
    const result: any[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        system += (system ? '\n\n' : '') + (msg.content ?? '');
        continue;
      }

      if (msg.role === 'tool' && msg.toolResults?.length) {
        for (const tr of msg.toolResults) {
          result.push({
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: tr.toolCallId,
                content:
                  typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result),
              },
            ],
          });
        }
        continue;
      }

      if (msg.role === 'assistant' && msg.toolCalls?.length) {
        const content: any[] = [];
        if (msg.content) {
          content.push({ type: 'text', text: msg.content });
        }
        for (const tc of msg.toolCalls) {
          content.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.name,
            input: tc.arguments,
          });
        }
        result.push({ role: 'assistant', content });
        continue;
      }

      result.push({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: msg.content ?? '',
      });
    }

    return { system, messages: result };
  }

  private convertTools(tools: ToolDefinition[]): any[] {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: this.zodToJsonSchema(tool.parameters),
    }));
  }

  private convertResponseMessage(response: any): Message {
    const textParts: string[] = [];
    const toolCalls: Message['toolCalls'] = [];

    for (const block of response.content) {
      if (block.type === 'text') {
        textParts.push(block.text);
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.input ?? {},
        });
      }
    }

    return {
      role: 'assistant',
      content: textParts.join('\n') || undefined,
      ...(toolCalls.length ? { toolCalls } : {}),
    };
  }

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
