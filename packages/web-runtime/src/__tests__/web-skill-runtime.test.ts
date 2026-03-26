import { describe, it, expect, vi } from 'vitest';
import { WebSkillRuntime } from '../web-skill-runtime.js';
import { MessageChannelTransport } from '../transports.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { z } from 'zod';

describe('WebSkillRuntime', () => {
  it('should register skills and respond to MCP tool calls', async () => {
    const runtime = new WebSkillRuntime({ name: 'my-runtime' });
    
    const mockHandler = vi.fn().mockResolvedValue({ status: 'ok' });
    runtime.registerSkill('echo', {
      description: 'Echos input',
      inputSchema: { msg: z.string() }
    }, mockHandler);

    expect(runtime.listSkills()).toHaveLength(1);
    expect(runtime.listSkills()[0].name).toBe('echo');

    // Setup communication via MessageChannel
    const channel = new MessageChannel();
    const serverTransport = new MessageChannelTransport(channel.port1);
    const clientTransport = new MessageChannelTransport(channel.port2);

    await runtime.connect(serverTransport);
    
    const client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });
    await client.connect(clientTransport);

    // Call the tool via MCP protocol
    const result = await client.callTool({
      name: 'echo',
      arguments: { msg: 'hello' }
    });

    expect(mockHandler).toHaveBeenCalledWith({ msg: 'hello' });
    expect((result as any).content[0]).toEqual({ type: 'text', text: '{"status":"ok"}' });

    await client.close();
    await runtime.close();
  });

  it('should handle tool list changed notification', async () => {
    const runtime = new WebSkillRuntime();
    const [serverT, clientT] = [{} as any, {} as any]; // Mock transports
    
    // We don't actually need to connect for this unit test if we mock the server's send method
    const server = runtime.getServer();
    const spy = vi.spyOn(server.server, 'sendToolListChanged');
    
    (runtime as any)._connected = true; // fake connect
    runtime.notifyToolsChanged();
    
    expect(spy).toHaveBeenCalled();
  });
});
