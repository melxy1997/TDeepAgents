import type { z } from 'zod';
import type { Message, StepEvent, SubAgentDef, SkillBundle } from '@tdeepagents/schemas';
import type { LLMAdapter, ToolDefinition, ToolContext, AgentState, ChatParams } from '@tdeepagents/adapters';
import { initAdapter } from '@tdeepagents/adapters';
import type { BackendProtocol } from '@tdeepagents/backends';
import { StateBackend } from '@tdeepagents/backends';
import type { Middleware, ToolCallRequest, ToolCallResult } from '@tdeepagents/middleware';
import {
  SummarizationMiddleware,
  PatchToolCallsMiddleware,
  HumanInTheLoopMiddleware,
  SkillsMiddleware,
  MemoryMiddleware,
} from '@tdeepagents/middleware';
import type { HITLConfig, HITLCallback } from '@tdeepagents/middleware';
import { writeTodosTool, createFilesystemTools, executeTool, createTaskTool } from '@tdeepagents/tools';
import { buildSystemPrompt } from './prompt-builder.js';
import { createRuntime, type Runtime } from './runtime.js';

// ─── Public Types ────────────────────────────────────────────────────

export interface DeepAgentOptions {
  /** Model string ("openai:gpt-4o", "anthropic:claude-sonnet-4-6") or LLMAdapter instance */
  model: string | LLMAdapter;
  /** Custom tools to add alongside built-in tools */
  tools?: ToolDefinition[];
  /** Custom system prompt (replaces default if provided) */
  systemPrompt?: string;
  /** Backend instance or factory function */
  backend?: BackendProtocol | ((runtime: Runtime) => BackendProtocol);
  /** Middleware pipeline */
  middleware?: Middleware[];
  /** Subagent definitions (automatically creates task tool) */
  subagents?: SubAgentDef[];
  /** HITL interrupt configuration */
  interruptOn?: HITLConfig;
  /** HITL callback for user decisions */
  onInterrupt?: HITLCallback;
  /** Memory file paths (AGENTS.md files) */
  memory?: string[];
  /** Skill directory paths */
  skills?: string[];
  /** SkillBundle JSON objects for browser/edge scenarios */
  skillBundles?: SkillBundle[];
  /** Structured output schema (Zod) for the final response */
  responseFormat?: z.ZodType;
  /** Maximum iterations before the agent stops (default: 50) */
  maxIterations?: number;
  /** Temperature for LLM calls */
  temperature?: number;
  /** Max output tokens for LLM calls */
  maxTokens?: number;
  /** Callback for each step event */
  onStep?: (event: StepEvent) => void | Promise<void>;
}

export interface AgentInput {
  messages: Message[];
  files?: Record<string, { content: string }>;
}

export interface AgentResult {
  messages: Message[];
  structuredResponse?: unknown;
  state: AgentState;
}

// ─── DeepAgent Class ─────────────────────────────────────────────────

export class DeepAgent {
  private adapter!: LLMAdapter;
  private options: DeepAgentOptions;
  private initialized = false;

  constructor(options: DeepAgentOptions) {
    this.options = options;
  }

  /**
   * Run the agent synchronously (complete execution).
   */
  async invoke(input: AgentInput): Promise<AgentResult> {
    await this.ensureInitialized();

    const backend = this.resolveBackend(input.files);
    const allTools = this.resolveTools(backend);
    const middlewares = this.resolveMiddlewares();
    const maxIterations = this.options.maxIterations ?? 50;

    // Initialize agent state
    const state: AgentState = {
      messages: [...input.messages],
      todos: [],
      files: input.files ?? {},
    };

    // Build system prompt and prepend
    const systemPrompt = buildSystemPrompt(this.options.systemPrompt, allTools);
    const systemMessage: Message = { role: 'system', content: systemPrompt };

    const runtime = createRuntime(this.adapter, backend, state, {});

    // Run beforeAgent middlewares (one-time init)
    for (const mw of middlewares) {
      if (mw.beforeAgent) {
        const update = await mw.beforeAgent(state, runtime);
        if (update) Object.assign(state, update);
      }
    }

    // ─── ReAct Loop ─────────────────────────────────────────────────

    let iteration = 0;

    while (iteration < maxIterations) {
      iteration++;

      // Prepare messages for LLM
      const llmMessages: Message[] = [systemMessage, ...state.messages];

      // Emit step event
      await this.emitStep({ type: 'llm_call', data: { iteration }, timestamp: Date.now(), iteration });

      // Call LLM
      const chatParams: ChatParams = {
        messages: llmMessages,
        tools: allTools,
        temperature: this.options.temperature,
        maxTokens: this.options.maxTokens,
        responseFormat: this.options.responseFormat,
      };

      let response;
      try {
        response = await this.adapter.chat(chatParams);
      } catch (error: any) {
        await this.emitStep({
          type: 'error',
          data: { error: error.message, iteration },
          timestamp: Date.now(),
          iteration,
        });
        throw error;
      }

      // Append assistant message to state
      state.messages.push(response.message);

      // If no tool calls → agent is done
      if (response.finishReason !== 'tool_calls' || !response.message.toolCalls?.length) {
        break;
      }

      // Execute tool calls
      const toolResults: Message['toolResults'] = [];

      for (const toolCall of response.message.toolCalls) {
        await this.emitStep({
          type: 'tool_call',
          data: { name: toolCall.name, args: toolCall.arguments, id: toolCall.id },
          timestamp: Date.now(),
          iteration,
        });

        const toolDef = allTools.find((t) => t.name === toolCall.name);
        if (!toolDef) {
          toolResults.push({
            toolCallId: toolCall.id,
            result: `Error: Unknown tool "${toolCall.name}"`,
          });
          continue;
        }

        const toolContext: ToolContext = {
          backend,
          agentState: state,
          config: runtime.config,
        };

        // Build the handler
        const baseHandler = async (req: ToolCallRequest): Promise<ToolCallResult> => {
          const result = await toolDef.handler(req.args, toolContext);
          return { toolCallId: req.id, result };
        };

        // Apply middleware wrapToolCall wrappers
        let handler = baseHandler;
        for (const mw of middlewares) {
          if (mw.wrapToolCall) {
            const currentMw = mw;
            const currentHandler = handler;
            handler = (req) => currentMw.wrapToolCall!(req, currentHandler);
          }
        }

        try {
          const result = await handler({
            id: toolCall.id,
            name: toolCall.name,
            args: toolCall.arguments,
          });
          toolResults.push(result);

          await this.emitStep({
            type: 'tool_result',
            data: { toolCallId: toolCall.id, name: toolCall.name, result: result.result },
            timestamp: Date.now(),
            iteration,
          });
        } catch (error: any) {
          toolResults.push({
            toolCallId: toolCall.id,
            result: `Error executing ${toolCall.name}: ${error.message}`,
          });
        }
      }

      // Append tool results as a tool message
      state.messages.push({
        role: 'tool',
        toolResults,
      });

      // Run afterAgent middlewares
      for (const mw of middlewares) {
        if (mw.afterAgent) {
          const update = await mw.afterAgent(state, runtime);
          if (update) Object.assign(state, update);
        }
      }
    }

    // ─── Final Result ───────────────────────────────────────────────

    const lastMessage = state.messages[state.messages.length - 1];
    let structuredResponse: unknown = undefined;

    // If responseFormat is set, try to parse the final response
    if (this.options.responseFormat && lastMessage?.content) {
      try {
        const parsed = JSON.parse(lastMessage.content);
        structuredResponse = this.options.responseFormat.parse(parsed);
      } catch {
        // Content is not JSON or doesn't match schema — leave as-is
      }
    }

    return {
      messages: state.messages,
      structuredResponse,
      state,
    };
  }

  /**
   * Stream the agent execution as step events.
   */
  async *stream(input: AgentInput): AsyncIterable<StepEvent> {
    // For now, wrap invoke and emit accumulated events
    // A full streaming implementation would use adapter.stream()
    const events: StepEvent[] = [];
    const originalOnStep = this.options.onStep;

    this.options.onStep = async (event) => {
      events.push(event);
      if (originalOnStep) await originalOnStep(event);
    };

    try {
      await this.invoke(input);
      for (const event of events) {
        yield event;
      }
    } finally {
      this.options.onStep = originalOnStep;
    }
  }

  // ─── Private Helpers ──────────────────────────────────────────────

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    if (typeof this.options.model === 'string') {
      this.adapter = await initAdapter(this.options.model);
    } else {
      this.adapter = this.options.model;
    }

    this.initialized = true;
  }

  private resolveBackend(files?: Record<string, { content: string }>): BackendProtocol {
    if (this.options.backend) {
      if (typeof this.options.backend === 'function') {
        const runtime = createRuntime(this.adapter, new StateBackend(files), { messages: [], todos: [], files: files ?? {} });
        return this.options.backend(runtime);
      }
      return this.options.backend;
    }
    return new StateBackend(files);
  }

  private resolveTools(backend: BackendProtocol): ToolDefinition[] {
    const tools: ToolDefinition[] = [];

    // 1. Planning tool
    tools.push(writeTodosTool);

    // 2. Filesystem tools
    tools.push(...createFilesystemTools());

    // 3. Execute tool (only if backend supports it)
    if (backend.execute) {
      tools.push(executeTool);
    }

    // 4. Subagent task tool
    if (this.options.subagents?.length) {
      const taskTool = createTaskTool(async (name, task, context) => {
        return this.spawnSubagent(name, task, context);
      });
      tools.push(taskTool);
    }

    // 5. User-provided tools
    if (this.options.tools) {
      tools.push(...this.options.tools);
    }

    return tools;
  }

  private resolveMiddlewares(): Middleware[] {
    const middlewares: Middleware[] = [];

    // Built-in: PatchToolCalls (always first)
    middlewares.push(new PatchToolCallsMiddleware());

    // Built-in: Summarization (always active)
    middlewares.push(new SummarizationMiddleware());

    // Optional: Memory
    if (this.options.memory?.length) {
      middlewares.push(new MemoryMiddleware(this.options.memory));
    }

    // Optional: Skills
    if (this.options.skills?.length || this.options.skillBundles?.length) {
      middlewares.push(new SkillsMiddleware(
        this.options.skills ?? [],
        { bundles: this.options.skillBundles },
      ));
    }

    // Optional: HITL
    if (this.options.interruptOn && this.options.onInterrupt) {
      middlewares.push(
        new HumanInTheLoopMiddleware(this.options.interruptOn, this.options.onInterrupt),
      );
    }

    // User-provided middlewares
    if (this.options.middleware) {
      middlewares.push(...this.options.middleware);
    }

    return middlewares;
  }

  private async spawnSubagent(
    name: string,
    task: string,
    context: ToolContext,
  ): Promise<string> {
    const subagentDef = this.options.subagents?.find((s) => s.name === name);

    // Create a fresh agent instance with isolated context
    const subAgent = new DeepAgent({
      model: subagentDef?.model ?? this.options.model,
      systemPrompt:
        subagentDef?.systemPrompt ??
        `You are a subagent named "${name}". Complete the assigned task and return a concise final report.`,
      tools: subagentDef?.tools as ToolDefinition[] | undefined,
      backend: this.options.backend, // Share backend for file access
      skills: subagentDef?.skills ?? this.options.skills, // Inherit main agent skills
      skillBundles: this.options.skillBundles, // Inherit bundles
      maxIterations: 20, // Subagents have a lower iteration limit
    });

    const result = await subAgent.invoke({
      messages: [{ role: 'user', content: task }],
    });

    // Extract final message content as the report
    const lastMessage = result.messages[result.messages.length - 1];
    return lastMessage?.content ?? 'Subagent completed without a final response.';
  }

  private async emitStep(event: StepEvent): Promise<void> {
    if (this.options.onStep) {
      await this.options.onStep(event);
    }
  }
}

// ─── Factory Function ────────────────────────────────────────────────

/**
 * Create a deep agent — the main entry point for TDeepAgents.
 *
 * @example
 * ```ts
 * const agent = createDeepAgent({
 *   model: 'openai:gpt-4o',
 *   systemPrompt: 'You are a helpful research assistant.',
 * });
 *
 * const result = await agent.invoke({
 *   messages: [{ role: 'user', content: 'Research TypeScript agent frameworks' }],
 * });
 * ```
 */
export function createDeepAgent(options: DeepAgentOptions): DeepAgent {
  return new DeepAgent(options);
}
