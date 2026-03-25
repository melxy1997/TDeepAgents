import type { ToolDefinition } from '@tdeepagents/adapters';

const BASE_PROMPT = `You are a capable AI agent equipped with tools for planning, file management, code execution, and task delegation.

## Core Workflow
1. **Plan first**: Use write_todos to break down complex tasks into steps
2. **Work systematically**: Update todo status as you progress through each step
3. **Use the filesystem**: Read and write files to manage context and produce artifacts
4. **Delegate when needed**: Use the task tool to hand off complex subtasks to subagents

## Tool Usage Guidelines
- When reading files, review the content before modifying
- Use edit_file (not write_file) to modify existing files
- For write_file, provide the complete file content
- Check file existence with ls before writing
- Use grep and glob to find files and patterns efficiently

## Best Practices
- Think step by step through complex problems
- Keep your context clean — write intermediate results to files
- Provide clear, complete responses to the user`;

/**
 * Builds the complete system prompt from components:
 * 1. Custom system prompt (or base prompt)
 * 2. Tool-specific prompts
 * 3. (Memory and skills injected by their middleware)
 */
export function buildSystemPrompt(
  customSystemPrompt: string | undefined,
  tools: ToolDefinition[],
): string {
  const parts: string[] = [];

  // 1. Base or custom system prompt
  parts.push(customSystemPrompt ?? BASE_PROMPT);

  // 2. Tool prompts
  const toolPrompts = tools
    .filter((t) => t.prompt)
    .map((t) => `### ${t.name}\n${t.prompt}`);

  if (toolPrompts.length > 0) {
    parts.push('\n## Tool-Specific Instructions\n' + toolPrompts.join('\n\n'));
  }

  return parts.join('\n\n');
}
