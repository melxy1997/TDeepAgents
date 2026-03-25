import type { Middleware, Runtime } from './types.js';
import type { AgentState } from '@tdeepagents/adapters';
import type { BackendProtocol } from '@tdeepagents/backends';

/**
 * MemoryMiddleware — loads AGENTS.md files into system prompt context.
 *
 * Memory files are always loaded (unlike skills which use progressive disclosure).
 * The agent can update memory files through normal filesystem tools.
 */
export class MemoryMiddleware implements Middleware {
  name = 'memory';
  private memoryPaths: string[];
  private loaded = false;

  constructor(memoryPaths: string[]) {
    this.memoryPaths = memoryPaths;
  }

  async beforeAgent(state: AgentState, runtime: Runtime): Promise<Partial<AgentState> | void> {
    if (this.loaded) return;
    this.loaded = true;

    const backend = runtime.backend as BackendProtocol;
    const memoryContents: string[] = [];

    for (const memPath of this.memoryPaths) {
      try {
        const content = await backend.read(memPath);
        if (!content.startsWith('Error:')) {
          // Remove line numbers from read output
          const clean = content
            .split('\n')
            .map((l) => l.replace(/^\d+:\s/, ''))
            .join('\n');
          memoryContents.push(`--- Memory: ${memPath} ---\n${clean}`);
        }
      } catch {
        // Memory file doesn't exist — skip
      }
    }

    if (memoryContents.length > 0) {
      const memoryMessage = {
        role: 'system' as const,
        content: `Persistent Memory:\n\n${memoryContents.join('\n\n')}`,
      };

      return {
        messages: [memoryMessage, ...state.messages],
      };
    }
  }
}
