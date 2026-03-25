import { z } from 'zod';
import type { ToolDefinition, ToolContext } from '@tdeepagents/adapters';
import type { BackendProtocol } from '@tdeepagents/backends';

/**
 * execute — Shell command execution tool.
 * Available only when the backend supports execute().
 */
export const executeTool: ToolDefinition = {
  name: 'execute',
  description:
    'Execute a shell command and return stdout, stderr, and exit code. ' +
    'Use this for running scripts, installing dependencies, running tests, etc. ' +
    'Large outputs may be truncated and saved to a file.',
  parameters: z.object({
    command: z.string().describe('Shell command to execute'),
    cwd: z.string().optional().describe('Working directory for the command'),
  }),
  handler: async (args: unknown, context: ToolContext) => {
    const { command, cwd } = z
      .object({ command: z.string(), cwd: z.string().optional() })
      .parse(args);

    const backend = context.backend as BackendProtocol;
    if (!backend.execute) {
      return 'Error: Execute is not available on the current backend. Use a FilesystemBackend or sandbox backend.';
    }

    const result = await backend.execute(command, cwd);

    let output = '';
    if (result.stdout) output += `STDOUT:\n${result.stdout}\n`;
    if (result.stderr) output += `STDERR:\n${result.stderr}\n`;
    output += `EXIT CODE: ${result.exitCode}`;
    if (result.truncated) output += '\n(Output was truncated)';

    return output;
  },
  prompt:
    'Use the execute tool to run shell commands when you need to install packages, ' +
    'run tests, compile code, or perform system operations.',
};
