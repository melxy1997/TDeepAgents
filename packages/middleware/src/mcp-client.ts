/**
 * mcp-client.ts — McpClientMiddleware
 *
 * Connects TDeepAgents to external MCP Servers (remote SSE/HTTP or in-browser
 * via MessageChannel). Automatically discovers tools from all connected servers
 * and intercepts matching tool calls to forward them via MCP protocol.
 *
 * Design:
 * - beforeAgent: connects to all configured MCP servers, lists their tools,
 *   injects tool descriptions into the system prompt.
 * - wrapToolCall: if a tool call matches an MCP-discovered tool, forwards it
 *   to the appropriate MCP server. Otherwise passes through to default handler.
 *
 * This middleware is transport-agnostic: it accepts any MCP Transport instance.
 * For browser scenarios, use MessageChannelTransport from @tdeepagents/web-runtime.
 * For server scenarios, use SSEClientTransport or StreamableHTTPClientTransport
 * from @modelcontextprotocol/sdk.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { Middleware, Runtime, ToolCallRequest, ToolHandler, ToolCallResult } from './types.js';
import type { AgentState } from '@tdeepagents/adapters';

// ─── Types ───────────────────────────────────────────────────────────

/** Configuration for a single MCP server connection */
export type McpServerConfig = {
  /** Human-readable server name (for logging) */
  name?: string;
  /** Pre-created Transport instance (MessageChannel, SSE, HTTP, etc.) */
  transport: Transport;
};

/** Configuration for the McpClientMiddleware */
export interface McpClientConfig {
  /** Named server configurations */
  servers: Record<string, McpServerConfig>;
}

/** Internal record of a discovered MCP tool */
interface McpToolRecord {
  /** Which MCP server this tool belongs to */
  serverName: string;
  /** MCP Client instance for calling the tool */
  client: Client;
  /** Tool metadata from the server */
  toolMeta: Tool;
}

// ─── McpClientMiddleware ─────────────────────────────────────────────

/**
 * McpClientMiddleware — Bridges TDeepAgents with the MCP ecosystem.
 *
 * Usage:
 * ```ts
 * import { McpClientMiddleware } from '@tdeepagents/middleware';
 *
 * const middleware = new McpClientMiddleware({
 *   servers: {
 *     'my-web-app': { transport: clientTransport },
 *     'remote-api': { transport: sseTransport },
 *   },
 * });
 * ```
 */
export class McpClientMiddleware implements Middleware {
  name = 'mcp-client';

  private _config: McpClientConfig;
  private _clients: Map<string, Client> = new Map();
  private _tools: Map<string, McpToolRecord> = new Map();
  private _connected = false;

  constructor(config: McpClientConfig) {
    this._config = config;
  }

  /**
   * beforeAgent: Connect to all MCP servers, discover tools,
   * and inject tool descriptions into the system prompt.
   */
  async beforeAgent(state: AgentState, _runtime: Runtime): Promise<Partial<AgentState> | void> {
    // Only connect once
    if (!this._connected) {
      await this._connectAll();
      this._connected = true;
    }

    // Refresh tool list from all servers
    await this._refreshTools();

    if (this._tools.size === 0) return;

    // Build tool description for system prompt
    const toolsList = [...this._tools.values()]
      .map((t) => {
        let entry = `- **${t.toolMeta.name}**`;
        if (t.toolMeta.description) entry += `: ${t.toolMeta.description}`;
        entry += ` [mcp:${t.serverName}]`;
        return entry;
      })
      .join('\n');

    const mcpMessage = {
      role: 'system' as const,
      content:
        `# MCP Tools (via McpClientMiddleware)\n\n` +
        `The following tools are available from connected MCP servers. ` +
        `Call them by name as regular tool calls.\n\n${toolsList}`,
    };

    return {
      messages: [mcpMessage, ...state.messages],
    };
  }

  /**
   * wrapToolCall: If the tool name matches an MCP-discovered tool,
   * forward the call via the MCP protocol. Otherwise, pass through.
   */
  async wrapToolCall(request: ToolCallRequest, handler: ToolHandler): Promise<ToolCallResult> {
    const mcpTool = this._tools.get(request.name);

    if (!mcpTool) {
      // Not an MCP tool — pass through to default handler
      return handler(request);
    }

    // Forward to MCP server
    try {
      const result = await mcpTool.client.callTool({
        name: request.name,
        arguments: request.args,
      });

      // Extract text content from MCP response
      let resultText: unknown = result;
      if (result && typeof result === 'object' && 'content' in result) {
        const content = (result as { content: Array<{ type: string; text?: string }> }).content;
        if (Array.isArray(content) && content.length > 0) {
          // Join all text content items
          const texts = content
            .filter((c) => c.type === 'text' && c.text)
            .map((c) => c.text);
          resultText = texts.length === 1 ? texts[0] : texts.join('\n');
        }
      }

      return {
        toolCallId: request.id,
        result: resultText,
      };
    } catch (err) {
      return {
        toolCallId: request.id,
        result: `MCP tool call error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  // ─── Internal ────────────────────────────────────────────────────

  /** Connect to all configured MCP servers */
  private async _connectAll(): Promise<void> {
    const entries = Object.entries(this._config.servers);

    await Promise.all(
      entries.map(async ([serverName, config]) => {
        try {
          const client = new Client(
            { name: `tda-mcp-client-${serverName}`, version: '1.0.0' },
            { capabilities: {} },
          );

          await client.connect(config.transport);
          this._clients.set(serverName, client);
        } catch (err) {
          // Log but don't throw — other servers may still work
          console.error(`[McpClientMiddleware] Failed to connect to "${serverName}":`, err);
        }
      }),
    );
  }

  /** Refresh tool list from all connected servers */
  private async _refreshTools(): Promise<void> {
    this._tools.clear();

    await Promise.all(
      [...this._clients.entries()].map(async ([serverName, client]) => {
        try {
          const response = await client.listTools();
          for (const tool of response.tools) {
            this._tools.set(tool.name, {
              serverName,
              client,
              toolMeta: tool,
            });
          }
        } catch (err) {
          console.error(`[McpClientMiddleware] Failed to list tools from "${serverName}":`, err);
        }
      }),
    );
  }

  /**
   * Get a snapshot of all discovered MCP tools.
   * Useful for debugging or UI display.
   */
  getDiscoveredTools(): Array<{ name: string; description?: string; server: string }> {
    return [...this._tools.values()].map((t) => ({
      name: t.toolMeta.name,
      description: t.toolMeta.description,
      server: t.serverName,
    }));
  }

  /**
   * Disconnect from all MCP servers and release resources.
   */
  async close(): Promise<void> {
    await Promise.all(
      [...this._clients.values()].map(async (client) => {
        try {
          await client.close();
        } catch {
          // Ignore close errors
        }
      }),
    );
    this._clients.clear();
    this._tools.clear();
    this._connected = false;
  }
}
