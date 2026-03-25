import { z } from 'zod';

export const SubAgentDefSchema = z.object({
  name: z.string(),
  description: z.string(),
  systemPrompt: z.string().optional(),
  tools: z.array(z.any()).optional(),
  model: z.string().optional(),
});
export type SubAgentDef = z.infer<typeof SubAgentDefSchema>;

export const AgentConfigSchema = z.object({
  name: z.string().default('deep-agent'),
  model: z.string().default('openai:gpt-4o'),
  systemPrompt: z.string().optional(),
  maxIterations: z.number().default(50),
  maxInputTokens: z.number().optional(),
  temperature: z.number().optional(),
  maxTokens: z.number().optional(),
});
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
