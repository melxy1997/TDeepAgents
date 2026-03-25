import { z } from 'zod';
import type { ToolDefinition, ToolContext } from '@tdeepagents/adapters';

/**
 * task — Subagent delegation tool.
 *
 * When invoked, spawns a new agent instance with isolated context.
 * The subagent executes autonomously until completion and returns a final report.
 *
 * NOTE: The actual spawning logic is injected by the core package at runtime.
 * This file defines the tool schema and a placeholder handler that will be
 * replaced when the agent is created.
 */
export function createTaskTool(
  spawnSubagent: (
    name: string,
    task: string,
    context: ToolContext,
  ) => Promise<string>,
): ToolDefinition {
  return {
    name: 'task',
    description:
      'Delegate a task to a subagent. The subagent runs with its own isolated context ' +
      'and returns a final report when done. Use this to delegate complex or lengthy work ' +
      'without cluttering your main context. Subagents can read/write files and use tools.',
    parameters: z.object({
      name: z
        .string()
        .describe(
          'Name of the subagent to use (must match a defined subagent name, or "general-purpose" for the default)',
        ),
      task: z
        .string()
        .describe('Detailed description of the task to delegate to the subagent'),
    }),
    handler: async (args: unknown, context: ToolContext): Promise<unknown> => {
      const { name, task } = z
        .object({ name: z.string(), task: z.string() })
        .parse(args);

      return spawnSubagent(name, task, context);
    },
    prompt:
      'Use the task tool to delegate work to subagents. This is useful for:\n' +
      '- Complex research tasks that produce large amounts of context\n' +
      '- Specialized work requiring different tools or configurations\n' +
      '- Parallelizing independent work streams\n' +
      'The subagent returns only a concise final report, keeping your context clean.',
  };
}
