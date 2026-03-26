import { describe, it, expect, vi } from 'vitest';
import { 
  setNavigator, 
  registerPageHandler, 
  withPageRouting, 
  WebSkillRuntime,
  MessageChannelTransport
} from '../index.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { z } from 'zod';

describe('PageToolBridge', () => {
  it('should forward tool calls via postMessage when route is active', async () => {
    const runtime = withPageRouting(new WebSkillRuntime());
    const mockHandler = vi.fn().mockResolvedValue('page-result');

    // 1. Register a routed skill
    runtime.registerSkill('get_user', {
      description: 'Gets user from page',
      inputSchema: { id: z.string() },
      route: '/profile'
    }, async () => {});

    // 2. Setup page-side handler
    registerPageHandler({
      route: '/profile',
      handlers: { get_user: mockHandler }
    });

    // 3. Setup MCP Client/Server connection
    const channel = new MessageChannel();
    const serverT = new MessageChannelTransport(channel.port1);
    const clientT = new MessageChannelTransport(channel.port2);
    await runtime.connect(serverT);
    
    const client = new Client({ name: 'test', version: '1' }, { capabilities: {} });
    await client.connect(clientT);

    // 4. Trigger tool call via MCP Protocol
    const result = await client.callTool({
      name: 'get_user',
      arguments: { id: '123' }
    });

    expect(result.content[0]).toEqual({ type: 'text', text: '"page-result"' });
    expect(mockHandler).toHaveBeenCalledWith({ id: '123' });

    await client.close();
    await runtime.close();
  });

  it('should call navigator when route is NOT active', async () => {
    const runtime = withPageRouting(new WebSkillRuntime());
    const mockNavigate = vi.fn();
    setNavigator(mockNavigate);

    runtime.registerSkill('get_settings', {
      description: 'Gets settings from page',
      inputSchema: {},
      route: '/settings',
      timeout: 100 // Short timeout for test
    }, async () => {});

    const channel = new MessageChannel();
    await runtime.connect(new MessageChannelTransport(channel.port1));
    const client = new Client({ name: 'test', version: '1' }, { capabilities: {} });
    await client.connect(new MessageChannelTransport(channel.port2));

    // Try to call tool on an inactive page
    try {
      await client.callTool({ name: 'get_settings', arguments: {} });
    } catch (e) {
      // Expect timeout error
    }

    expect(mockNavigate).toHaveBeenCalledWith('/settings');

    await client.close();
    await runtime.close();
  });
});
