import { z } from 'zod';

export const SkillMetadataSchema = z.object({
  name: z.string(),
  description: z.string(),
  path: z.string(),
});
export type SkillMetadata = z.infer<typeof SkillMetadataSchema>;
