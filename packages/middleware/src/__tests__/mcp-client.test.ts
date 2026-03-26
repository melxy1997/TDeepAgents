import { describe, it, expect, vi } from 'vitest';
import { McpClientMiddleware } from '../mcp-client.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

describe('McpClientMiddleware', () => {
  it('should list tools from server and inject them into system prompt', async () => {
    // 1. Setup a mock MCP Server
    const server = new McpServer({ name: 'test-server', version: '1.0.0' });
    server.registerTool('get_test_data', { 
      description: 'Gets test data', 
      inputSchema: { id: z.string() } 
    }, async ({ id }: any) => ({ 
      content: [{ type: 'text', text: 'data-' + id }] 
    }));
    
    const [serverT, clientT] = InMemoryTransport.createLinkedPair();
    await server.connect(serverT);

    // 2. Setup Middleware
    const middleware = new McpClientMiddleware({
      servers: {
        'test-server': { transport: clientT }
      }
    });

    const state = { 
      messages: [{ role: 'user' as const, content: 'hello' }],
      todos: [],
      files: []
    } as any;
    const runtime = {} as any;

    // 3. Run beforeAgent
    const result = await middleware.beforeAgent(state, runtime);

    expect(result).toBeDefined();
    if (result && result.messages) {
      const systemPrompt = result.messages[0].content;
      expect(systemPrompt).toContain('get_test_data');
      expect(systemPrompt).toContain('Gets test data');
      expect(systemPrompt).toContain('[mcp:test-server]');
    }

    // 4. Cleanup
    await middleware.close();
    await server.close();
  });

  it('should intercept and forward tool calls matching MCP tools', async () => {
    const server = new McpServer({ name: 'calc-server', version: '1.0.0' });
    server.registerTool('add', { 
      description: 'Add two numbers', 
      inputSchema: { a: z.number(), b: z.number() } 
    }, async ({ a, b }: any) => ({ 
      content: [{ type: 'text', text: String(Number(a) + Number(b)) }] 
    }));
    
    const [serverT, clientT] = InMemoryTransport.createLinkedPair();
    await server.connect(serverT);

    const middleware = new McpClientMiddleware({
      servers: { 'calc-server': { transport: clientT } }
    });

    // Connect first
    await middleware.beforeAgent({ messages: [], todos: [], files: [] } as any, {} as any);

    const request = { id: 'call-1', name: 'add', args: { a: 10, b: 20 } };
    const nextHandler = vi.fn();

    const response = await middleware.wrapToolCall(request, nextHandler);

    expect(response.toolCallId).toBe('call-1');
    expect(response.result).toBe('30');
    expect(nextHandler).not.toHaveBeenCalled();

    await middleware.close();
    await server.close();
  });

  it('should pass through non-MCP tool calls', async () => {
    const middleware = new McpClientMiddleware({ servers: {} });
    const request = { id: 'call-2', name: 'local_tool', args: {} };
    const nextHandler = vi.fn().mockResolvedValue({ toolCallId: 'call-2', result: 'local-ok' });

    const response = await middleware.wrapToolCall(request, nextHandler);

    expect(response.result).toBe('local-ok');
    expect(nextHandler).toHaveBeenCalledWith(request);
  });
});
