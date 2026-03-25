import type { Middleware, Runtime, ToolCallRequest, ToolHandler, ToolCallResult } from './types.js';
import type { AgentState, LLMAdapter } from '@tdeepagents/adapters';
import type { BackendProtocol } from '@tdeepagents/backends';
import type { Message } from '@tdeepagents/schemas';

const OFFLOAD_THRESHOLD = 20_000; // chars (rough proxy for tokens)
const SUMMARIZE_RATIO = 0.85; // trigger at 85% of context window
const KEEP_RECENT_RATIO = 0.10; // keep 10% as recent context
const DEFAULT_MAX_TOKENS = 170_000;
const DEFAULT_KEEP_MESSAGES = 6;

/**
 * SummarizationMiddleware — context compression.
 *
 * 1. Offloading: Truncates large tool call inputs/results (>20k tokens) and
 *    saves them to the backend filesystem, replacing with a file reference.
 * 2. Summarization: When context reaches 85% of the model's window, generates
 *    a structured summary and replaces the conversation history.
 */
export class SummarizationMiddleware implements Middleware {
  name = 'summarization';

  async afterAgent(state: AgentState, runtime: Runtime): Promise<Partial<AgentState> | void> {
    const adapter = runtime.adapter as LLMAdapter;
    const backend = runtime.backend as BackendProtocol;
    const maxTokens = adapter.maxInputTokens ?? DEFAULT_MAX_TOKENS;
    const messages = state.messages;

    // Step 1: Offload large tool results
    const offloadedMessages = await this.offloadLargeResults(messages, backend);

    // Step 2: Check if summarization is needed
    const estimatedTokens = this.estimateTokens(offloadedMessages);
    const threshold = maxTokens * SUMMARIZE_RATIO;

    if (estimatedTokens > threshold) {
      const summarized = await this.summarize(offloadedMessages, adapter, backend, maxTokens);
      return { messages: summarized };
    }

    if (offloadedMessages !== messages) {
      return { messages: offloadedMessages };
    }
  }

  private async offloadLargeResults(
    messages: Message[],
    backend: BackendProtocol,
  ): Promise<Message[]> {
    const result: Message[] = [];

    for (const msg of messages) {
      if (msg.role === 'tool' && msg.toolResults?.length) {
        const newResults = [];
        for (const tr of msg.toolResults) {
          const resultStr = typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result);
          if (resultStr.length > OFFLOAD_THRESHOLD) {
            // Save to backend
            const fileName = `/_offloaded/tool_result_${tr.toolCallId}.txt`;
            await backend.write(fileName, resultStr).catch(() => {
              // If file exists, force write via edit or ignore
            });
            const preview = resultStr.slice(0, 500);
            newResults.push({
              toolCallId: tr.toolCallId,
              result: `[Output saved to ${fileName}]\n\nPreview:\n${preview}...`,
            });
          } else {
            newResults.push(tr);
          }
        }
        result.push({ ...msg, toolResults: newResults });
      } else if (
        msg.role === 'assistant' &&
        msg.content &&
        msg.content.length > OFFLOAD_THRESHOLD
      ) {
        // Truncate very large assistant messages
        const fileName = `/_offloaded/assistant_${Date.now()}.txt`;
        await backend.write(fileName, msg.content).catch(() => {});
        const preview = msg.content.slice(0, 500);
        result.push({
          ...msg,
          content: `[Full content saved to ${fileName}]\n\nPreview:\n${preview}...`,
        });
      } else {
        result.push(msg);
      }
    }

    return result;
  }

  private async summarize(
    messages: Message[],
    adapter: LLMAdapter,
    backend: BackendProtocol,
    maxTokens: number,
  ): Promise<Message[]> {
    // Save full conversation to backend
    const historyFileName = `/_history/conversation_${Date.now()}.json`;
    await backend.write(historyFileName, JSON.stringify(messages, null, 2)).catch(() => {});

    // Determine how many recent messages to keep
    const keepCount = Math.max(DEFAULT_KEEP_MESSAGES, Math.floor(messages.length * KEEP_RECENT_RATIO));
    const toSummarize = messages.slice(0, -keepCount);
    const toKeep = messages.slice(-keepCount);

    if (toSummarize.length === 0) return messages;

    // Generate summary
    const summaryPrompt: Message[] = [
      {
        role: 'system',
        content:
          'You are a summarization assistant. Generate a concise structured summary of the conversation below. Include:\n' +
          '1. Session intent: What the user wanted to accomplish\n' +
          '2. Artifacts created: Files written or modified\n' +
          '3. Key decisions made\n' +
          '4. Current status and next steps\n' +
          'Be concise but comprehensive.',
      },
      {
        role: 'user',
        content: `Summarize this conversation:\n\n${toSummarize.map((m) => `[${m.role}]: ${m.content ?? '(tool call/result)'}`).join('\n')}`,
      },
    ];

    try {
      const response = await adapter.chat({ messages: summaryPrompt });
      const summaryContent = response.message.content ?? 'Summary unavailable';

      // Replace old messages with summary
      return [
        {
          role: 'system',
          content: `[Previous conversation summary — full history saved to ${historyFileName}]\n\n${summaryContent}`,
        },
        ...toKeep,
      ];
    } catch {
      // If summarization fails, just keep recent messages
      return toKeep;
    }
  }

  private estimateTokens(messages: Message[]): number {
    // Rough estimate: ~4 chars per token
    return messages.reduce((acc, m) => {
      let chars = m.content?.length ?? 0;
      if (m.toolCalls) {
        chars += JSON.stringify(m.toolCalls).length;
      }
      if (m.toolResults) {
        chars += JSON.stringify(m.toolResults).length;
      }
      return acc + Math.ceil(chars / 4);
    }, 0);
  }
}
