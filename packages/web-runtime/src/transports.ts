/**
 * transports.ts — Browser-safe MCP Transport implementations.
 *
 * Provides MessageChannel-based transports for in-browser MCP communication
 * between WebSkillRuntime (server) and McpClientMiddleware (client).
 *
 * Uses the standard MCP Transport interface from @modelcontextprotocol/sdk.
 */

import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

/**
 * MCP Transport backed by a browser MessagePort.
 *
 * Each side of a MessageChannel gets one MessageChannelTransport instance.
 * Messages are serialized as structured clones (no JSON.stringify overhead
 * when both ends are in the same origin).
 */
export class MessageChannelTransport implements Transport {
  private _port: MessagePort;
  private _started = false;

  sessionId?: string;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  constructor(port: MessagePort) {
    this._port = port;
  }

  async start(): Promise<void> {
    if (this._started) return;
    this._started = true;

    this._port.onmessage = (event: MessageEvent) => {
      const data = event.data;
      if (data && typeof data === 'object' && 'jsonrpc' in data) {
        this.onmessage?.(data as JSONRPCMessage);
      }
    };

    this._port.onmessageerror = () => {
      this.onerror?.(new Error('MessagePort: deserialization error'));
    };

    // MessagePort requires explicit start() when using onmessage
    this._port.start();
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (!this._started) {
      throw new Error('MessageChannelTransport: not started');
    }
    this._port.postMessage(message);
  }

  async close(): Promise<void> {
    this._started = false;
    this._port.onmessage = null;
    this._port.onmessageerror = null;
    this._port.close();
    this.onclose?.();
  }
}

/**
 * Create a paired set of MCP Transports using a browser MessageChannel.
 *
 * Returns [serverTransport, clientTransport] — connect the server to
 * `serverTransport` and the client to `clientTransport`.
 *
 * @example
 * ```ts
 * const [serverTransport, clientTransport] = createMessageChannelPair();
 * await runtime.connect(serverTransport);
 * await mcpClient.connect(clientTransport);
 * ```
 */
export function createMessageChannelPair(): [MessageChannelTransport, MessageChannelTransport] {
  const channel = new MessageChannel();
  return [
    new MessageChannelTransport(channel.port1),
    new MessageChannelTransport(channel.port2),
  ];
}
