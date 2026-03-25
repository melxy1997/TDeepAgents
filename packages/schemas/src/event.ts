import { z } from 'zod';

export const StepTypeSchema = z.enum([
  'llm_call',
  'tool_call',
  'tool_result',
  'summary',
  'error',
  'hitl_interrupt',
]);
export type StepType = z.infer<typeof StepTypeSchema>;

export const StepEventSchema = z.object({
  type: StepTypeSchema,
  data: z.unknown(),
  timestamp: z.number(),
  iteration: z.number().optional(),
});
export type StepEvent = z.infer<typeof StepEventSchema>;
