/**
 * TDeepAgents — Basic Agent Example
 *
 * Demonstrates how to create a deep agent with built-in tools
 * (planning, filesystem, execute) and run a simple task.
 *
 * Usage:
 *   OPENAI_API_KEY=sk-... npx tsx index.ts
 */
import { createDeepAgent, FilesystemBackend } from '@tdeepagents/core';

async function main() {
  // Create a deep agent with local filesystem backend
  const agent = createDeepAgent({
    model: 'openai:gpt-4o',
    systemPrompt: 'You are a helpful research assistant. Break tasks into steps using write_todos.',
    backend: new FilesystemBackend({ rootDir: '.', virtualMode: true, enableExecute: true }),
    // Step event callback for observability
    onStep: (event) => {
      console.log(`[${event.type}]`, JSON.stringify(event.data).slice(0, 200));
    },
  });

  // Run the agent
  const result = await agent.invoke({
    messages: [
      {
        role: 'user',
        content: 'List the files in the current directory and tell me what you see.',
      },
    ],
  });

  // Print the final response
  const lastMessage = result.messages[result.messages.length - 1];
  console.log('\n=== Agent Response ===');
  console.log(lastMessage?.content ?? 'No response');
}

main().catch(console.error);
