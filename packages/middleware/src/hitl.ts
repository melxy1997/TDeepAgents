import type { Middleware, ToolCallRequest, ToolHandler, ToolCallResult } from './types.js';

export type HITLDecision = 'approve' | 'reject' | 'edit';

export interface HITLConfig {
  [toolName: string]: boolean | { allowedDecisions: HITLDecision[] };
}

/**
 * Callback function the host app must provide.
 * Called when HITL interrupt is triggered.
 * Returns the user's decision and optionally modified arguments.
 */
export type HITLCallback = (request: {
  toolName: string;
  args: Record<string, unknown>;
  allowedDecisions: HITLDecision[];
}) => Promise<{
  decision: HITLDecision;
  modifiedArgs?: Record<string, unknown>;
  message?: string;
}>;

/**
 * HumanInTheLoopMiddleware — pauses before specified tool calls
 * for user approval, rejection, or argument editing.
 */
export class HumanInTheLoopMiddleware implements Middleware {
  name = 'human-in-the-loop';
  private config: HITLConfig;
  private callback: HITLCallback;

  constructor(config: HITLConfig, callback: HITLCallback) {
    this.config = config;
    this.callback = callback;
  }

  async wrapToolCall(
    request: ToolCallRequest,
    handler: ToolHandler,
  ): Promise<ToolCallResult> {
    const toolConfig = this.config[request.name];

    // No HITL config for this tool — proceed normally
    if (!toolConfig) {
      return handler(request);
    }

    // Determine allowed decisions
    const allowedDecisions: HITLDecision[] =
      typeof toolConfig === 'boolean'
        ? ['approve', 'edit', 'reject']
        : toolConfig.allowedDecisions;

    // Call the HITL callback
    const response = await this.callback({
      toolName: request.name,
      args: request.args,
      allowedDecisions,
    });

    switch (response.decision) {
      case 'approve':
        return handler(request);

      case 'edit':
        // Use modified args if provided
        const modifiedRequest = response.modifiedArgs
          ? { ...request, args: response.modifiedArgs }
          : request;
        return handler(modifiedRequest);

      case 'reject':
        return {
          toolCallId: request.id,
          result: `Tool call rejected by user.${response.message ? ` Reason: ${response.message}` : ''}`,
        };

      default:
        return handler(request);
    }
  }
}
