/**
 * webmcp-shim.ts — W3C WebMCP Polyfill for navigator.modelContext.
 *
 * Implements the proposed W3C WebMCP API:
 * https://webmachinelearning.github.io/webmcp/
 *
 * This shim bridges navigator.modelContext.registerTool() calls
 * to the TDeepAgents WebSkillRuntime.
 */

import type { WebSkillRuntime } from './web-skill-runtime.js';

/**
 * W3C WebMCP Tool Definition
 * @see https://webmachinelearning.github.io/webmcp/#dom-modelcontexttool
 */
export interface ModelContextTool {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
  execute: (input: any) => Promise<any>;
}

/**
 * W3C WebMCP ModelContext interface
 * @see https://webmachinelearning.github.io/webmcp/#modelcontext-interface
 */
export interface ModelContext {
  registerTool(tool: ModelContextTool): void;
  provideContext(options?: { tools?: ModelContextTool[] }): void;
}

/**
 * Initialize the navigator.modelContext shim.
 *
 * @param runtime - The WebSkillRuntime instance to bridge calls to.
 * @param force - If true, overwrite existing navigator.modelContext (default: false).
 */
export function initWebMcpShim(runtime: WebSkillRuntime, force = false): void {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return;
  }

  const nav = navigator as any;

  // Don't overwrite if it already exists, unless forced
  if (nav.modelContext && !force) {
    console.warn('navigator.modelContext already exists. Use force=true to overwrite.');
    return;
  }

  const modelContext: ModelContext = {
    /**
     * registerTool — Bridge native-style tool registration to WebSkillRuntime.
     */
    registerTool(tool: ModelContextTool): void {
      const { name, description, inputSchema, execute } = tool;

      // Note: WebSkillRuntime.registerSkill expects a ZodRawShape for type safety,
      // but since WebMCP provides raw JSON Schema, we bridge it directly
      // using an internal registration method or casting.
      // Here we leverage the fact that registerSkill's inputSchema is generic.
      // We pass the JSON Schema as if it were a Zod object (internal cast)
      // because WebSkillRuntime.registerSkill will convert it anyway.

      // Actually, let's add a raw JSON Schema registration method to WebSkillRuntime
      // or just call the internal _server.registerTool directly.
      const mcpServer = runtime.getServer();

      mcpServer.registerTool(name, { description, inputSchema }, async (args) => {
        const result = await execute(args);

        // Normalize result to MCP content format
        if (
          result &&
          typeof result === 'object' &&
          'content' in result &&
          Array.isArray((result as any).content)
        ) {
          return result;
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
        };
      });

      // Also ensure it's in the local skills map for introspection
      (runtime as any)._skills?.set(name, {
        name,
        description,
        inputSchema,
      });

      runtime.notifyToolsChanged();
    },

    /**
     * provideContext — Batch registration of tools.
     */
    provideContext(options?: { tools?: ModelContextTool[] }): void {
      if (options?.tools) {
        for (const tool of options.tools) {
          this.registerTool(tool);
        }
      }
    },
  };

  // Inject into navigator
  try {
    Object.defineProperty(nav, 'modelContext', {
      value: modelContext,
      writable: true,
      configurable: true,
    });
  } catch (e) {
    console.error('Failed to inject navigator.modelContext shim:', e);
  }
}
