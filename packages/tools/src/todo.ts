import { z } from 'zod';
import type { ToolDefinition, ToolContext } from '@tdeepagents/adapters';

/**
 * write_todos — Planning tool for task breakdown and progress tracking.
 * Replaces the entire todo list with the provided items.
 */
export const writeTodosTool: ToolDefinition = {
  name: 'write_todos',
  description:
    'Create or update a todo list for tracking tasks. ' +
    'Provide the complete list of todos — this replaces any existing list. ' +
    'Use statuses: "pending" (not started), "in_progress" (currently working on), "completed" (done).',
  parameters: z.object({
    todos: z.array(
      z.object({
        id: z.string().describe('Unique identifier for this todo item'),
        task: z.string().describe('Description of the task'),
        status: z
          .enum(['pending', 'in_progress', 'completed'])
          .describe('Current status of the task'),
        notes: z.string().optional().describe('Optional notes about the task'),
      }),
    ),
  }),
  handler: async (args: unknown, context: ToolContext): Promise<unknown> => {
    const parsed = z
      .object({
        todos: z.array(
          z.object({
            id: z.string(),
            task: z.string(),
            status: z.enum(['pending', 'in_progress', 'completed']),
            notes: z.string().optional(),
          }),
        ),
      })
      .parse(args);

    // Store todos in agent state
    context.agentState.todos = parsed.todos;

    const summary = parsed.todos.reduce(
      (acc, todo) => {
        acc[todo.status] = (acc[todo.status] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    return {
      success: true,
      totalTodos: parsed.todos.length,
      summary,
    };
  },
  prompt:
    'Use write_todos to track your tasks. Break complex work into smaller steps. ' +
    'Update todo statuses as you progress through your work.',
};
