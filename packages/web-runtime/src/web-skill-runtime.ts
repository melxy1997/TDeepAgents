/**
 * web-skill-runtime.ts — Browser-side WebSkills Runtime.
 *
 * Wraps the standard MCP McpServer to let frontend developers register
 * business functions as AI-callable tools via a simple API:
 *
 * ```ts
 * const runtime = new WebSkillRuntime({ name: 'my-app', version: '1.0.0' });
 *
 * runtime.registerSkill('search_flights', {
 *   description: 'Search available flights',
 *   inputSchema: { origin: z.string(), dest: z.string() },
 * }, async ({ origin, dest }) => {
 *   return { flights: await api.search(origin, dest) };
 * });
 *
 * const [serverT, clientT] = createMessageChannelPair();
 * await runtime.connect(serverT);
 * // clientT → pass to McpClientMiddleware
 * ```
 *
 * Key design decisions:
 * - Uses @modelcontextprotocol/sdk McpServer directly (no custom protocol)
 * - Accepts Zod schemas in inputSchema (same as MCP SDK's registerTool)
 * - Returns MCP-compliant tool results { content: [{ type, text }] }
 * - Keeps a local registry for listSkills() introspection
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { z, type ZodRawShape } from 'zod';
import type { WebSkillDefinition } from '@tdeepagents/schemas';
import { zodToJsonSchema } from '@tdeepagents/schemas';

// ─── Types ───────────────────────────────────────────────────────────

/** Configuration for creating a WebSkillRuntime instance */
export interface WebSkillRuntimeConfig {
  /** Server name (shown to MCP clients during handshake) */
  name?: string;
  /** Server version */
  version?: string;
}

/**
 * Configuration for a single skill registration.
 * inputSchema uses Zod's ZodRawShape (same as MCP SDK's registerTool).
 */
export interface SkillConfig<T extends ZodRawShape> {
  /** Human-readable title (optional) */
  title?: string;
  /** Description shown to LLM for tool selection */
  description: string;
  /** Zod schema defining input parameters */
  inputSchema: T;
  /** Target route for SPA page-routing (optional) */
  route?: string;
  /** Timeout for page-routed calls in ms (optional, default 30000) */
  timeout?: number;
}

/** Skill handler function — receives validated params, returns any result */
export type SkillHandler<T extends ZodRawShape> = (
  params: Record<string, unknown>,
) => Promise<unknown>;

// ─── WebSkillRuntime ─────────────────────────────────────────────────

/**
 * WebSkillRuntime — the core browser-side runtime for registering
 * business functions as MCP tools.
 *
 * Lifecycle:
 * 1. Create: `new WebSkillRuntime()`
 * 2. Register: `runtime.registerSkill(name, config, handler)`
 * 3. Connect: `await runtime.connect(transport)`
 *
 * After connect(), the MCP server is live and ready to receive
 * tool calls from the connected MCP client.
 */
export class WebSkillRuntime {
  private _server: McpServer;
  private _transport: Transport | undefined;
  private _skills: Map<string, WebSkillDefinition> = new Map();
  private _connected = false;

  constructor(config?: WebSkillRuntimeConfig) {
    this._server = new McpServer(
      {
        name: config?.name ?? 'tdeepagents-web-runtime',
        version: config?.version ?? '1.0.0',
      },
      {
        capabilities: {
          tools: { listChanged: true },
        },
      },
    );
  }

  /**
   * Register a browser-side function as an MCP tool (WebSkill).
   *
   * @param name - Unique tool name
   * @param config - Tool metadata + Zod input schema
   * @param handler - Async function that implements the tool logic
   */
  registerSkill<T extends ZodRawShape>(
    name: string,
    config: SkillConfig<T>,
    handler: SkillHandler<T>,
  ): void {
    const { description, inputSchema, title, route, timeout } = config;

    // Register with MCP SDK using the config-based registerTool() API
    // We use any cast for the internal call to handle complex MCP SDK overloads
    // while keeping the public registerSkill API clean and typed.
    (this._server as any).registerTool(
      name,
      {
        title: title ?? name,
        description,
        inputSchema,
      },
      async (params: any) => {
        const result = await handler(params);

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
      },
    );

    // Keep local registry for introspection
    // Build JSON Schema from Zod for the definition (used by listSkills)
    const schemaObj = z.object(inputSchema);
    const jsonSchema = zodToJsonSchema(schemaObj);

    this._skills.set(name, {
      name,
      description,
      inputSchema: jsonSchema as Record<string, unknown>,
      route,
      timeout,
    });
  }

  /**
   * Connect the runtime to an MCP Transport.
   *
   * After this call, the MCP server is live and will respond
   * to tool listing and tool call requests.
   */
  async connect(transport: Transport): Promise<void> {
    if (this._connected) {
      throw new Error('WebSkillRuntime: already connected');
    }
    this._transport = transport;
    await this._server.connect(transport);
    this._connected = true;
  }

  /**
   * Close the connection and release resources.
   */
  async close(): Promise<void> {
    if (!this._connected) return;
    await this._server.close();
    this._connected = false;
    this._transport = undefined;
  }

  /**
   * Check if the runtime is connected to a transport.
   */
  isConnected(): boolean {
    return this._connected;
  }

  /**
   * List all registered skill definitions (for introspection/debugging).
   */
  listSkills(): WebSkillDefinition[] {
    return [...this._skills.values()];
  }

  /**
   * Get the underlying MCP Server for advanced usage.
   */
  getServer(): McpServer {
    return this._server;
  }

  /**
   * Notify connected clients that the tool list has changed.
   * Call this after dynamically registering/removing skills post-connect.
   */
  notifyToolsChanged(): void {
    if (this._connected) {
      this._server.server.sendToolListChanged();
    }
  }
}
