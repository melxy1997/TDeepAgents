import { z } from 'zod';
import type { ToolDefinition, ToolContext } from '@tdeepagents/adapters';
import type { BackendProtocol } from '@tdeepagents/backends';

/**
 * Creates the 6 filesystem tools: ls, read_file, write_file, edit_file, glob, grep.
 * All delegate to the BackendProtocol.
 */
export function createFilesystemTools(): ToolDefinition[] {
  return [lsTool, readFileTool, writeFileTool, editFileTool, globTool, grepTool];
}

function getBackend(context: ToolContext): BackendProtocol {
  return context.backend as BackendProtocol;
}

// ─── ls ──────────────────────────────────────────────────────────────

const lsTool: ToolDefinition = {
  name: 'ls',
  description: 'List files and directories in a given path.',
  parameters: z.object({
    path: z.string().default('/').describe('Directory path to list'),
  }),
  handler: async (args: unknown, context: ToolContext) => {
    const { path } = z.object({ path: z.string().default('/') }).parse(args);
    const entries = await getBackend(context).lsInfo(path);
    if (entries.length === 0) return 'Empty directory or path not found.';
    return entries
      .map((e) => {
        const type = e.isDir ? '[DIR]' : '[FILE]';
        const size = e.size != null ? ` (${e.size} bytes)` : '';
        return `${type} ${e.path}${size}`;
      })
      .join('\n');
  },
};

// ─── read_file ───────────────────────────────────────────────────────

const readFileTool: ToolDefinition = {
  name: 'read_file',
  description:
    'Read the content of a file with line numbers. ' +
    'Supports pagination via offset and limit (default: first 2000 lines). ' +
    'Can read text files and images (png, jpg, jpeg, gif, webp).',
  parameters: z.object({
    path: z.string().describe('Path to the file to read'),
    offset: z.number().default(0).describe('Line offset to start reading from (0-indexed)'),
    limit: z.number().default(2000).describe('Maximum number of lines to return'),
  }),
  handler: async (args: unknown, context: ToolContext) => {
    const { path, offset, limit } = z
      .object({
        path: z.string(),
        offset: z.number().default(0),
        limit: z.number().default(2000),
      })
      .parse(args);
    return getBackend(context).read(path, offset, limit);
  },
};

// ─── write_file ──────────────────────────────────────────────────────

const writeFileTool: ToolDefinition = {
  name: 'write_file',
  description:
    'Create a new file with the given content. ' +
    'This is create-only — if the file already exists, use edit_file instead.',
  parameters: z.object({
    path: z.string().describe('Path for the new file'),
    content: z.string().describe('Content to write to the file'),
  }),
  handler: async (args: unknown, context: ToolContext) => {
    const { path, content } = z.object({ path: z.string(), content: z.string() }).parse(args);
    const result = await getBackend(context).write(path, content);
    if (result.error) return `Error: ${result.error}`;
    // Merge filesUpdate into agent state
    if (result.filesUpdate) {
      context.agentState.files = { ...context.agentState.files, ...result.filesUpdate };
    }
    return `File created: ${result.path}`;
  },
};

// ─── edit_file ───────────────────────────────────────────────────────

const editFileTool: ToolDefinition = {
  name: 'edit_file',
  description:
    'Edit a file by replacing a specific string with a new string. ' +
    'Provide the exact old string and the new replacement string. ' +
    'By default, the old string must appear exactly once (set replace_all=true for multiple occurrences).',
  parameters: z.object({
    path: z.string().describe('Path to the file to edit'),
    old_string: z.string().describe('The exact string to find and replace'),
    new_string: z.string().describe('The replacement string'),
    replace_all: z
      .boolean()
      .default(false)
      .describe('If true, replace all occurrences; otherwise only replace if unique'),
  }),
  handler: async (args: unknown, context: ToolContext) => {
    const { path, old_string, new_string, replace_all } = z
      .object({
        path: z.string(),
        old_string: z.string(),
        new_string: z.string(),
        replace_all: z.boolean().default(false),
      })
      .parse(args);

    const result = await getBackend(context).edit(path, old_string, new_string, replace_all);
    if (result.error) return `Error: ${result.error}`;
    if (result.filesUpdate) {
      context.agentState.files = { ...context.agentState.files, ...result.filesUpdate };
    }
    return `Edited ${result.path} (${result.occurrences} occurrence(s) replaced)`;
  },
};

// ─── glob ────────────────────────────────────────────────────────────

const globTool: ToolDefinition = {
  name: 'glob',
  description:
    'Find files matching a glob pattern (e.g., "**/*.ts", "src/**/*.py"). ' +
    'Returns matching file paths with metadata.',
  parameters: z.object({
    pattern: z.string().describe('Glob pattern to match files'),
    path: z.string().default('/').describe('Base path to search from'),
  }),
  handler: async (args: unknown, context: ToolContext) => {
    const { pattern, path } = z
      .object({ pattern: z.string(), path: z.string().default('/') })
      .parse(args);
    const results = await getBackend(context).globInfo(pattern, path);
    if (results.length === 0) return 'No files matched the pattern.';
    return results.map((f) => f.path).join('\n');
  },
};

// ─── grep ────────────────────────────────────────────────────────────

const grepTool: ToolDefinition = {
  name: 'grep',
  description:
    'Search for a regex pattern in files. Returns matching lines with file paths and line numbers.',
  parameters: z.object({
    pattern: z.string().describe('Regular expression pattern to search for'),
    path: z.string().optional().describe('Directory or file path to search in'),
    glob: z.string().optional().describe('Optional glob pattern to filter files (e.g., "*.ts")'),
  }),
  handler: async (args: unknown, context: ToolContext) => {
    const { pattern, path, glob } = z
      .object({
        pattern: z.string(),
        path: z.string().optional(),
        glob: z.string().optional(),
      })
      .parse(args);

    const results = await getBackend(context).grepRaw(pattern, path, glob);
    if (typeof results === 'string') return results; // error message
    if (results.length === 0) return 'No matches found.';
    return results.map((m) => `${m.path}:${m.line}: ${m.text}`).join('\n');
  },
};
