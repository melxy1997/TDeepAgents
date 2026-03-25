import type { Middleware, Runtime } from './types.js';
import type { AgentState } from '@tdeepagents/adapters';
import type { Message } from '@tdeepagents/schemas';

/**
 * PatchToolCallsMiddleware — fixes message history when tool calls
 * are interrupted before receiving results.
 *
 * Scans for assistant messages with tool_calls that don't have
 * matching tool result messages, and adds synthetic error results.
 */
export class PatchToolCallsMiddleware implements Middleware {
  name = 'patch-tool-calls';

  async beforeAgent(state: AgentState): Promise<Partial<AgentState> | void> {
    const messages = state.messages;
    const patched = this.patchOrphanedToolCalls(messages);

    if (patched !== messages) {
      return { messages: patched };
    }
  }

  private patchOrphanedToolCalls(messages: Message[]): Message[] {
    // Collect all tool result IDs
    const answeredToolCallIds = new Set<string>();
    for (const msg of messages) {
      if (msg.role === 'tool' && msg.toolResults) {
        for (const tr of msg.toolResults) {
          answeredToolCallIds.add(tr.toolCallId);
        }
      }
    }

    // Find orphaned tool calls (no matching result)
    const result: Message[] = [...messages];
    const patchMessages: Message[] = [];

    for (const msg of messages) {
      if (msg.role === 'assistant' && msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          if (!answeredToolCallIds.has(tc.id)) {
            // Add a synthetic error result
            patchMessages.push({
              role: 'tool',
              toolResults: [
                {
                  toolCallId: tc.id,
                  result:
                    'Error: This tool call was interrupted before receiving a result. ' +
                    'The operation may not have completed. Please retry if needed.',
                },
              ],
            });
          }
        }
      }
    }

    if (patchMessages.length > 0) {
      return [...result, ...patchMessages];
    }

    return messages;
  }
}
