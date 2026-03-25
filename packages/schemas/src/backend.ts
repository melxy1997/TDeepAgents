import { z } from 'zod';

export const FileInfoSchema = z.object({
  path: z.string(),
  isDir: z.boolean().optional(),
  size: z.number().optional(),
  modifiedAt: z.string().optional(),
});
export type FileInfo = z.infer<typeof FileInfoSchema>;

export const GrepMatchSchema = z.object({
  path: z.string(),
  line: z.number(),
  text: z.string(),
});
export type GrepMatch = z.infer<typeof GrepMatchSchema>;

export const WriteResultSchema = z.object({
  error: z.string().optional(),
  path: z.string().optional(),
  filesUpdate: z.record(z.unknown()).optional(),
});
export type WriteResult = z.infer<typeof WriteResultSchema>;

export const EditResultSchema = z.object({
  error: z.string().optional(),
  path: z.string().optional(),
  filesUpdate: z.record(z.unknown()).optional(),
  occurrences: z.number().optional(),
});
export type EditResult = z.infer<typeof EditResultSchema>;

export const ExecuteResultSchema = z.object({
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number(),
  truncated: z.boolean().optional(),
  outputFile: z.string().optional(),
});
export type ExecuteResult = z.infer<typeof ExecuteResultSchema>;
