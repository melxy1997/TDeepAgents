import { z } from 'zod';

// ─── Tool Call & Result ───────────────────────────────────────────────

export const ToolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  arguments: z.record(z.unknown()),
});
export type ToolCall = z.infer<typeof ToolCallSchema>;

export const ToolResultSchema = z.object({
  toolCallId: z.string(),
  result: z.unknown(),
});
export type ToolResult = z.infer<typeof ToolResultSchema>;

// ─── Message ──────────────────────────────────────────────────────────

export const MessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  content: z.string().optional(),
  toolCalls: z.array(ToolCallSchema).optional(),
  toolResults: z.array(ToolResultSchema).optional(),
});
export type Message = z.infer<typeof MessageSchema>;
