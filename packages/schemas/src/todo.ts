import { z } from 'zod';

export const TodoStatusSchema = z.enum(['pending', 'in_progress', 'completed']);
export type TodoStatus = z.infer<typeof TodoStatusSchema>;

export const TodoItemSchema = z.object({
  id: z.string(),
  task: z.string(),
  status: TodoStatusSchema,
  notes: z.string().optional(),
});
export type TodoItem = z.infer<typeof TodoItemSchema>;

export const TodoListSchema = z.array(TodoItemSchema);
export type TodoList = z.infer<typeof TodoListSchema>;
